// MCP connections for Agent (chat + → "Add Connections" → Custom MCP Server). Each member stores their own
// remote MCP servers. A chat turn offers the enabled tools of the enabled connections as ordinary client tools
// (mcp_<connection>_<tool>) and this server runs them itself (Streamable HTTP JSON-RPC initialize →
// notifications/initialized → tools/call, through safefetch.ts), so the approval mode applies to connected apps like
// to any other action ("Always ask" prompts before using connected apps, "Review for me" before risky actions -
// Handing servers to the API's MCP connector ran them where no approval could stop a
// write. Connecting checks the token and lists the tools the same way. Workspace controls: "Enable custom MCP servers"
// (space.settings.ai_custom_mcp) and the URL allowlist (ai_mcp_allowlist). Tokens are never returned to clients.
import { newId } from '@nc/shared/ids.ts';
import { db } from '../db.ts';
import { FetchBlockedError, safeFetch } from '../safefetch.ts';
import { mcpServerAllowed, workspaceAiPolicy } from './aiPolicy.ts';
import { AiError, scrub } from './client.ts';
import { registerDynamicTools } from './tools/defs.ts';
import type { AgentEnv, Risk, ToolOutput } from './tools/types.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS ai_mcp_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  token TEXT,
  tools TEXT NOT NULL DEFAULT '[]',
  disabled_tools TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_time INTEGER NOT NULL,
  checked_time INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_mcp_user ON ai_mcp_connections(user_id, space_id);
`);
// added_by: Custom Agent connections (user_id = the agent's bot) remember who authenticated them — only that person
// may change their tool settings or re-authenticate 
try {
  db.exec('ALTER TABLE ai_mcp_connections ADD COLUMN added_by TEXT');
} catch {
  /* column exists */
}

// Workspace shared MCPs : servers a workspace owner adds once; members (and their Custom Agents) pick them
// in "Add connection" (badge "Workspace Managed") and sign in with their own token — no shared session. A preset's
// URL is approved by creating it: its connections work even with "Enable custom MCP servers" off.
db.exec(`
CREATE TABLE IF NOT EXISTS ai_mcp_presets (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  auth TEXT NOT NULL DEFAULT 'none',
  created_by TEXT NOT NULL,
  created_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_mcp_presets_space ON ai_mcp_presets(space_id);
`);
try {
  db.exec('ALTER TABLE ai_mcp_connections ADD COLUMN preset_id TEXT');
} catch {
  /* column exists */
}

const PROTOCOL = '2025-06-18';
const MAX_CONNECTIONS = 20;

export interface McpTool {
  name: string;
  description?: string;
  /** annotations.readOnlyHint / destructiveHint (shown next to each tool) */
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
  /** JSON schema of the arguments (Custom Agents call MCP tools client-side) */
  inputSchema?: Record<string, unknown>;
}

export interface McpConnection {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
  tools: McpTool[];
  disabledTools: string[];
  enabled: boolean;
  createdTime: number;
  checkedTime: number | null;
  error: string | null;
  /** agent connections: who connected it */
  addedBy?: string | null;
  /** connected from a workspace shared MCP ("Workspace Managed") */
  presetId?: string | null;
}

interface Row {
  id: string;
  user_id: string;
  space_id: string;
  name: string;
  url: string;
  token: string | null;
  tools: string;
  disabled_tools: string;
  enabled: number;
  created_time: number;
  checked_time: number | null;
  error: string | null;
  added_by?: string | null;
  preset_id?: string | null;
}

const toConnection = (r: Row): McpConnection => ({
  id: r.id, name: r.name, url: r.url, hasToken: !!r.token, tools: (JSON.parse(r.tools || '[]') as McpTool[]).map(({ inputSchema: _s, ...t }) => t),
  disabledTools: JSON.parse(r.disabled_tools || '[]'), enabled: !!r.enabled, createdTime: r.created_time, checkedTime: r.checked_time, error: r.error, addedBy: r.added_by ?? null,
  presetId: r.preset_id ?? null,
});

function rows(userId: string, spaceId: string): Row[] {
  return db.prepare('SELECT * FROM ai_mcp_connections WHERE user_id = ? AND space_id = ? ORDER BY created_time').all(userId, spaceId) as unknown as Row[];
}

function row(userId: string, id: string): Row | undefined {
  const r = db.prepare('SELECT * FROM ai_mcp_connections WHERE id = ?').get(String(id)) as Row | undefined;
  return r && r.user_id === userId ? r : undefined;
}

export function listConnections(userId: string, spaceId: string): McpConnection[] {
  return rows(userId, spaceId).map(toConnection);
}

/** https only — loopback http is accepted for local development (NC_DEV_ALLOW_LOOPBACK_FETCH=1), like safefetch. */
export function validateServerUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new AiError('bad_request', 'Enter a valid MCP server URL.', 400);
  }
  const loopbackDev = process.env.NODE_ENV !== 'production' && process.env.NC_DEV_ALLOW_LOOPBACK_FETCH === '1' && /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopbackDev)) throw new AiError('bad_request', 'MCP server URLs must use HTTPS.', 400);
  if (u.username || u.password) throw new AiError('bad_request', 'Put credentials in the token field, not in the URL.', 400);
  return u;
}

function parseRpc(body: Buffer, contentType: string, id: number): any {
  const text = body.toString('utf8');
  const candidates: string[] = [];
  if (/text\/event-stream/i.test(contentType)) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) candidates.push(data);
    }
  } else candidates.push(text);
  for (const c of candidates) {
    try {
      const msg = JSON.parse(c);
      for (const m of Array.isArray(msg) ? msg : [msg]) if (m && m.id === id) return m;
    } catch {
      /* not JSON */
    }
  }
  throw new Error('The server did not return a valid MCP response.');
}

async function rpc(url: string, token: string | null, session: string | null, id: number | null, method: string, params?: unknown): Promise<{ result?: any; session: string | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'mcp-protocol-version': PROTOCOL,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(session ? { 'mcp-session-id': session } : {}),
  };
  const res = await safeFetch(url, {
    method: 'POST', headers, accept: 'application/json, text/event-stream', timeoutMs: 8000, maxBytes: 2 * 1024 * 1024,
    body: JSON.stringify({ jsonrpc: '2.0', ...(id !== null ? { id } : {}), method, ...(params !== undefined ? { params } : {}) }),
  });
  const sid = res.headers?.['mcp-session-id'];
  const nextSession = (Array.isArray(sid) ? sid[0] : sid) ?? session;
  if (res.status === 401 || res.status === 403) throw new Error('The MCP server rejected the credentials.');
  if (id === null) return { session: nextSession };
  if (res.status >= 400) throw new Error(`The MCP server answered with HTTP ${res.status}.`);
  const msg = parseRpc(res.body, res.contentType, id);
  if (msg.error) throw new Error(String(msg.error.message ?? 'MCP error').slice(0, 200));
  return { result: msg.result, session: nextSession };
}

/** initialize → initialized → tools/list (connection check and tool listing). */
export async function fetchServerTools(url: string, token: string | null): Promise<McpTool[]> {
  try {
    const init = await rpc(url, token, null, 1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Litpage', version: '1.0.0' } });
    await rpc(url, token, init.session, null, 'notifications/initialized');
    const list = await rpc(url, token, init.session, 2, 'tools/list', {});
    const tools = Array.isArray(list.result?.tools) ? list.result.tools : [];
    return tools.slice(0, 200).filter((t: any) => typeof t?.name === 'string').map((t: any) => ({
      name: String(t.name).slice(0, 128),
      description: typeof t.description === 'string' ? t.description.slice(0, 500) : undefined,
      readOnly: !!t.annotations?.readOnlyHint,
      destructive: !!t.annotations?.destructiveHint,
      openWorld: !!t.annotations?.openWorldHint,
      ...(t.inputSchema && typeof t.inputSchema === 'object' && JSON.stringify(t.inputSchema).length <= 20_000 ? { inputSchema: t.inputSchema } : {}),
    }));
  } catch (e) {
    if (e instanceof FetchBlockedError) throw new AiError('bad_request', 'Failed to connect: this URL can’t be reached from Litpage.', 400);
    throw new AiError('bad_request', `Connection failed: ${scrub(String((e as Error)?.message ?? e)).slice(0, 200)}`, 400);
  }
}

/** A workspace shared MCP with exactly this URL (approved by its creation). */
function presetFor(spaceId: string, url: string): PresetRow | undefined {
  return db.prepare('SELECT * FROM ai_mcp_presets WHERE space_id = ? AND url = ?').get(spaceId, url) as PresetRow | undefined;
}

function assertAllowed(spaceId: string, url: string) {
  if (presetFor(spaceId, url)) return;
  const policy = workspaceAiPolicy(spaceId);
  if (!policy.customMcp) throw new AiError('forbidden', 'Custom MCP servers are off in this workspace. Ask an owner to enable them.', 403);
  if (!mcpServerAllowed(policy, url)) throw new AiError('forbidden', 'This MCP server URL is not approved for this workspace.', 403);
}

export async function addConnection(userId: string, spaceId: string, input: { name?: unknown; url?: unknown; token?: unknown; presetId?: unknown }, addedBy?: string): Promise<McpConnection> {
  // "Workspace Managed": the preset gives the URL and name; the member brings their own token
  const preset = typeof input.presetId === 'string' ? (db.prepare('SELECT * FROM ai_mcp_presets WHERE id = ? AND space_id = ?').get(input.presetId, spaceId) as PresetRow | undefined) : undefined;
  if (typeof input.presetId === 'string' && !preset) throw new AiError('not_found', 'That workspace MCP doesn’t exist anymore.', 404);
  if (preset) input = { ...input, url: preset.url, name: preset.name };
  if (preset?.auth === 'token' && !(typeof input.token === 'string' && input.token.trim())) throw new AiError('bad_request', `Sign in to ${preset.name}: paste your access token.`, 400);
  const u = validateServerUrl(String(input.url ?? ''));
  assertAllowed(spaceId, u.toString());
  if (rows(userId, spaceId).length >= MAX_CONNECTIONS) throw new AiError('bad_request', `You can connect up to ${MAX_CONNECTIONS} MCP servers.`, 400);
  const token = typeof input.token === 'string' && input.token.trim() ? input.token.trim().slice(0, 4000) : null;
  const tools = await fetchServerTools(u.toString(), token);
  const name = (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : u.hostname).slice(0, 60);
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO ai_mcp_connections (id, user_id, space_id, name, url, token, tools, created_time, checked_time, added_by, preset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, spaceId, name, u.toString(), token, JSON.stringify(tools), now, now, addedBy ?? null, preset?.id ?? null);
  return toConnection(row(userId, id)!);
}

// ---------------------------------------------------------------- workspace shared MCPs 

interface PresetRow {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  url: string;
  auth: 'none' | 'token';
  created_by: string;
  created_time: number;
}

export interface McpPreset {
  id: string;
  name: string;
  description: string | null;
  url: string;
  auth: 'none' | 'token';
  createdBy: string;
  createdTime: number;
}

const toPreset = (r: PresetRow): McpPreset => ({ id: r.id, name: r.name, description: r.description, url: r.url, auth: r.auth === 'token' ? 'token' : 'none', createdBy: r.created_by, createdTime: r.created_time });

export function listPresets(spaceId: string): McpPreset[] {
  return (db.prepare('SELECT * FROM ai_mcp_presets WHERE space_id = ? ORDER BY created_time').all(spaceId) as unknown as PresetRow[]).map(toPreset);
}

/** New workspace MCP (owners; the caller checks): Name, Description, Server URL, how members authenticate. */
export function createPreset(userId: string, spaceId: string, input: { name?: unknown; description?: unknown; url?: unknown; auth?: unknown }): McpPreset {
  const u = validateServerUrl(String(input.url ?? ''));
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) throw new AiError('bad_request', 'Give the MCP server a name.', 400);
  if (presetFor(spaceId, u.toString())) throw new AiError('bad_request', 'This MCP server is already shared with the workspace.', 400);
  if ((db.prepare('SELECT COUNT(*) AS n FROM ai_mcp_presets WHERE space_id = ?').get(spaceId) as { n: number }).n >= 50) throw new AiError('bad_request', 'A workspace can share up to 50 MCP servers.', 400);
  const id = newId();
  db.prepare('INSERT INTO ai_mcp_presets (id, space_id, name, description, url, auth, created_by, created_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, spaceId, name, typeof input.description === 'string' ? input.description.trim().slice(0, 300) || null : null, u.toString(), input.auth === 'token' ? 'token' : 'none', userId, Date.now());
  return toPreset(db.prepare('SELECT * FROM ai_mcp_presets WHERE id = ?').get(id) as unknown as PresetRow);
}

/** Remove workspace preset: existing connections keep working only while the URL is otherwise allowed. */
export function deletePreset(spaceId: string, id: string): boolean {
  return Number(db.prepare('DELETE FROM ai_mcp_presets WHERE id = ? AND space_id = ?').run(id, spaceId).changes ?? 0) > 0;
}

// ---------------------------------------------------------------- Custom Agent connections 
// Stored like a person's connections with user_id = the agent's bot id; only the agent's runs use them. The agent's
// tools are called client-side (tools/call through safefetch) so each tool's run mode — Run automatically / Always ask /
// Always allow — can stop a write before it happens.

/** Full rows (with tool schemas) of an owner's connections; tokens never leave the server. */
export function connectionTools(ownerId: string, spaceId: string): { id: string; name: string; url: string; enabled: boolean; tools: McpTool[]; disabledTools: string[]; addedBy: string | null; presetId: string | null; error: string | null; checkedTime: number | null }[] {
  return rows(ownerId, spaceId).map((r) => ({
    id: r.id, name: r.name, url: r.url, enabled: !!r.enabled, tools: JSON.parse(r.tools || '[]'), disabledTools: JSON.parse(r.disabled_tools || '[]'), addedBy: r.added_by ?? null,
    presetId: r.preset_id ?? null, error: r.error ?? null, checkedTime: r.checked_time ?? null,
  }));
}

/** Call one MCP tool (initialize → initialized → tools/call). Returns the text content and the error flag. */
export async function callMcpTool(ownerId: string, connectionId: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const r = row(ownerId, connectionId);
  if (!r) throw new AiError('not_found', 'That connection doesn’t exist.', 404);
  if (!r.enabled) throw new AiError('forbidden', 'That connection is turned off.', 403);
  assertAllowed(r.space_id, r.url);
  try {
    const init = await rpc(r.url, r.token, null, 1, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Litpage', version: '1.0.0' } });
    await rpc(r.url, r.token, init.session, null, 'notifications/initialized');
    const res = await rpc(r.url, r.token, init.session, 3, 'tools/call', { name: tool, arguments: args });
    const content = Array.isArray(res.result?.content) ? res.result.content : [];
    const text = content.map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : c?.type ? `[${c.type}]` : '')).filter(Boolean).join('\n').slice(0, 100_000);
    return { text: text || '(no content)', isError: !!res.result?.isError };
  } catch (e) {
    if (e instanceof FetchBlockedError) throw new AiError('bad_request', 'This MCP server can’t be reached from Litpage.', 400);
    throw new AiError('bad_request', `The MCP server failed: ${scrub(String((e as Error)?.message ?? e)).slice(0, 200)}`, 400);
  }
}

/** Remove every connection of an owner (an agent moved to Trash permanently). */
export function removeOwnerConnections(ownerId: string) {
  db.prepare('DELETE FROM ai_mcp_connections WHERE user_id = ?').run(ownerId);
}

export async function refreshConnection(userId: string, id: string): Promise<McpConnection> {
  const r = row(userId, id);
  if (!r) throw new AiError('not_found', 'That connection doesn’t exist.', 404);
  try {
    const tools = await fetchServerTools(r.url, r.token);
    db.prepare('UPDATE ai_mcp_connections SET tools = ?, checked_time = ?, error = NULL WHERE id = ?').run(JSON.stringify(tools), Date.now(), id);
  } catch (e) {
    db.prepare('UPDATE ai_mcp_connections SET checked_time = ?, error = ? WHERE id = ?').run(Date.now(), (e as Error).message.slice(0, 300), id);
  }
  return toConnection(row(userId, id)!);
}

export function updateConnection(userId: string, id: string, patch: { enabled?: unknown; disabledTools?: unknown; name?: unknown }): McpConnection {
  const r = row(userId, id);
  if (!r) throw new AiError('not_found', 'That connection doesn’t exist.', 404);
  if (typeof patch.enabled === 'boolean') db.prepare('UPDATE ai_mcp_connections SET enabled = ? WHERE id = ?').run(patch.enabled ? 1 : 0, id);
  if (Array.isArray(patch.disabledTools)) db.prepare('UPDATE ai_mcp_connections SET disabled_tools = ? WHERE id = ?').run(JSON.stringify(patch.disabledTools.filter((x) => typeof x === 'string').slice(0, 200)), id);
  if (typeof patch.name === 'string' && patch.name.trim()) db.prepare('UPDATE ai_mcp_connections SET name = ? WHERE id = ?').run(patch.name.trim().slice(0, 60), id);
  return toConnection(row(userId, id)!);
}

export function removeConnection(userId: string, id: string) {
  const r = row(userId, id);
  if (r) db.prepare('DELETE FROM ai_mcp_connections WHERE id = ?').run(id);
}

/** Workspace admins: every member's custom connections (governance — "Disconnect all"). */
export function removeAllConnections(spaceId: string): number {
  return Number(db.prepare('DELETE FROM ai_mcp_connections WHERE space_id = ?').run(spaceId).changes ?? 0);
}

// ---------------------------------------------------------------- Agent (chat): MCP tools as client tools

/** Client tool name of a connection's tool (the same shape Custom Agents use — agents/tools.ts). */
export function mcpToolName(connectionId: string, tool: string): string {
  const slug = tool.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `mcp_${connectionId.replace(/-/g, '').slice(0, 8)}_${slug}`.slice(0, 64);
}
registerDynamicTools((name) => /^mcp_[0-9a-f]{8}_/.test(name));

export interface ChatMcpTool {
  connectionId: string;
  connectionName: string;
  tool: McpTool;
}

/**
 * The person's MCP tools for a chat turn: enabled tools of their enabled connections (optionally limited to `ids`;
 * read-only tools only with `readOnly`), as client tool definitions. Connections the workspace no longer allows are
 * skipped (workspace shared MCPs are approved by the owner who added them; other servers follow the custom MCP
 * switch and URL allowlist).
 */
export function chatMcpTools(userId: string, spaceId: string, ids?: string[] | null, opts: { readOnly?: boolean } = {}): {
  defs: { name: string; description: string; input_schema: Record<string, unknown> }[];
  map: Map<string, ChatMcpTool>;
} {
  const policy = workspaceAiPolicy(spaceId);
  const defs: { name: string; description: string; input_schema: Record<string, unknown> }[] = [];
  const map = new Map<string, ChatMcpTool>();
  for (const r of rows(userId, spaceId)) {
    if (!r.enabled || (ids && !ids.includes(r.id))) continue;
    if (!presetFor(spaceId, r.url) && (!policy.customMcp || !mcpServerAllowed(policy, r.url))) continue;
    const disabled = new Set(JSON.parse(r.disabled_tools || '[]') as string[]);
    for (const t of JSON.parse(r.tools || '[]') as McpTool[]) {
      if (disabled.has(t.name) || (opts.readOnly && !t.readOnly)) continue;
      const name = mcpToolName(r.id, t.name);
      if (map.has(name)) continue;
      map.set(name, { connectionId: r.id, connectionName: r.name, tool: t });
      const schema = t.inputSchema && (t.inputSchema as { type?: string }).type === 'object' ? t.inputSchema : { type: 'object', properties: {} };
      defs.push({ name, description: `${r.name} › ${t.name}${t.description ? `: ${t.description}` : ''}`.slice(0, 1000), input_schema: schema });
    }
  }
  return { defs, map };
}

/** Approval risk of running an MCP tool; null for a read-only tool (reads never ask). Any other tool acts in the
 *  connected app (sends, posts, changes data there), so "Review for me" asks for it like for sending mail or posting
 *  to Slack, and "Always ask" always asks; destructive tools are flagged. */
export function mcpToolRisk(t: McpTool): Risk | null {
  if (t.readOnly) return null;
  return t.destructive ? 'destructive' : 'share';
}

/** Run one chat MCP tool as `env.userId` with the turn's approval mode (step rows with Input / Response). */
export async function runChatMcpTool(env: AgentEnv, m: ChatMcpTool, input: Record<string, unknown>, stepId: string): Promise<ToolOutput> {
  const label = `${m.connectionName} • ${m.tool.name}`;
  const inputText = JSON.stringify(input ?? {}, null, 2).slice(0, 4000);
  const mcp = { server: m.connectionName, tool: m.tool.name, input: inputText };
  env.step({ id: stepId, tool: 'mcp', status: 'running', label: 'Running tool', detail: label, mcp });
  const risk = mcpToolRisk(m.tool);
  if (risk) {
    const decision = await env.approve({
      tool: 'mcp', stepId, risk,
      payload: { title: `Run ${m.tool.name}`, description: `${m.connectionName}${m.tool.destructive ? ' · may delete or overwrite data' : ''}`, markdown: '```json\n' + inputText + '\n```', confirmLabel: 'Continue', danger: risk === 'destructive' },
    });
    if (decision !== 'accept') {
      env.step({ id: stepId, tool: 'mcp', status: 'declined', label: 'Run tool', detail: label, mcp });
      return { content: 'The user rejected running this tool, so it didn’t run. Do not retry it; ask the user how they would like to proceed.' };
    }
  }
  try {
    const r = await callMcpTool(env.userId, m.connectionId, m.tool.name, input);
    const out = { ...mcp, output: r.text.slice(0, 4000) };
    if (r.isError) env.step({ id: stepId, tool: 'mcp', status: 'error', label: 'Running tool', detail: label, error: r.text.slice(0, 300) || 'The MCP tool failed.', mcp: out });
    else env.step({ id: stepId, tool: 'mcp', status: 'done', label: `Ran MCP tool: ${m.tool.name}`, detail: m.connectionName, mcp: out });
    return { content: r.text, isError: r.isError };
  } catch (e) {
    const message = e instanceof AiError ? e.message : 'The MCP tool failed.';
    env.step({ id: stepId, tool: 'mcp', status: 'error', label: 'Running tool', detail: label, error: message, mcp });
    return { content: message, isError: true };
  }
}

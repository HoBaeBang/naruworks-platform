// A tiny remote MCP server for E2E tests (Streamable HTTP transport, JSON responses): initialize,
// notifications/initialized, tools/list (get_weather, delete_everything) and tools/call. Requests must carry
// "Authorization: Bearer <token>" when a token is configured. Usage:
//   import { startFakeMcp } from './ai-mcp-fake.mjs'; const mcp = await startFakeMcp(3115, { token: 'mcp-secret' });
//   … mcp.calls (tool calls received) … mcp.close()
import { createServer } from 'node:http';

export function startFakeMcp(port, { token = null } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }));
      return;
    }
    let raw = '';
    for await (const c of req) raw += c;
    const msg = JSON.parse(raw || '{}');
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fake-session' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    };
    if (msg.method?.startsWith('notifications/')) {
      res.writeHead(202);
      res.end();
      return;
    }
    if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Fake Weather', version: '1.0.0' } });
    if (msg.method === 'tools/list') {
      return reply({
        tools: [
          { name: 'get_weather', description: 'Current weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }, annotations: { readOnlyHint: true } },
          { name: 'delete_everything', description: 'Dangerous test tool', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
        ],
      });
    }
    if (msg.method === 'tools/call') {
      calls.push(msg.params);
      if (msg.params?.name === 'get_weather') return reply({ content: [{ type: 'text', text: `Sunny, 21°C in ${msg.params.arguments?.city ?? 'somewhere'}` }] });
      return reply({ content: [{ type: 'text', text: 'Refused.' }], isError: true });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32601, message: 'Method not found' } }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}/mcp`, calls, close: () => server.close() })));
}

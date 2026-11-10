// The workspace an agent tool call works in. A tool runs for a chat, an MCP token or a Custom Agent of
// one workspace (env.spaceId); the pages it reads and writes must belong to that workspace — a person who is also in
// another workspace must not reach its pages through this one's AI (which would bypass that workspace's AI
// / MCP switches). registry.runTool sets the scope around each call; the AI primitives (ai/edit.ts,
// ai/context.ts) treat blocks of other workspaces as not found while it is set.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<{ spaceId: string }>();

/** Run `fn` with tool calls limited to `spaceId`. */
export function inToolWorkspace<T>(spaceId: string, fn: () => T): T {
  return store.run({ spaceId }, fn);
}

/** The workspace the running tool call is limited to (null outside tool calls). */
export function toolWorkspace(): string | null {
  return store.getStore()?.spaceId ?? null;
}

/** False when a tool call is running for another workspace than `spaceId`. */
export function inScope(spaceId: string | undefined): boolean {
  const scope = toolWorkspace();
  return !scope || spaceId === scope;
}

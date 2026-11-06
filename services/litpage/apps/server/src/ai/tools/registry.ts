// Agent tool registry: definition (defs.ts) + validated execution as a given user. Shared by the chat agent
// (service.ts), the MCP server and — later — Custom Agents. Errors become tool results
// (is_error) the model can react to; nothing an executor throws escapes as an HTTP error.
import { AiError, scrub } from '../client.ts';
import { EXTRA_TOOL_DEFS, TOOL_DEFS, validateInput, type ToolDef } from './defs.ts';
import { READ_TOOL_RUNS } from './read.ts';
import type { AgentEnv, ToolOutput, ToolRun } from './types.ts';
import { WRITE_TOOL_RUNS } from './write.ts';
import { inToolWorkspace } from './scope.ts';

const RUNS: Record<string, ToolRun> = { ...READ_TOOL_RUNS, ...WRITE_TOOL_RUNS };

/** Executors of surface-specific tools (defs.ts EXTRA_TOOL_DEFS; Custom Agents register theirs). */
export function registerToolRuns(runs: Record<string, ToolRun>) {
  for (const [name, run] of Object.entries(runs)) if (!RUNS[name]) RUNS[name] = run;
}

export function toolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name) ?? EXTRA_TOOL_DEFS.find((t) => t.name === name);
}

export function isWriteTool(name: string): boolean {
  return toolDef(name)?.access === 'write';
}

/**
 * Validate and run one tool call. `allowed` limits the tools of the current mode (Ask / Research: read-only),
 * so a tool name the model invents or a write in a read-only chat is refused here as well.
 */
export async function runTool(env: AgentEnv, name: string, input: unknown, stepId: string, allowed?: Set<string>): Promise<ToolOutput> {
  const run = RUNS[name];
  if (!run || (allowed && !allowed.has(name))) return { content: `The tool ${name} isn’t available in this chat.`, isError: true };
  const v = validateInput(name, input);
  if (!v.ok) return { content: `Invalid input: ${v.error}`, isError: true };
  try {
    // everything the tool reads or writes stays in the workspace it runs for (tools/scope.ts)
    return await inToolWorkspace(env.spaceId, () => run(env, v.value, stepId));
  } catch (e) {
    const message = e instanceof AiError ? e.message : `Tool failed: ${scrub(String((e as Error)?.message ?? e)).slice(0, 300)}`;
    if (!(e instanceof AiError)) console.error(`[ai] tool ${name} failed`, scrub(String((e as Error)?.stack ?? e)).slice(0, 800));
    env.step({ id: stepId, tool: name, status: 'error', label: 'Error', error: message });
    return { content: message, isError: true };
  }
}

// Runtime types shared by the agent tool executors (read.ts, write.ts) and their callers (the chat turn in
// service.ts, the MCP server in appMcp.ts — and Custom Agents later). An AgentEnv is "who is acting
// and where": every executor reads and writes strictly as env.userId.
import type { ApprovalMode } from '../aiPolicy.ts';
import type { TouchedPage } from '../changes.ts';

export interface StepRef {
  pageId?: string;
  url?: string;
  title: string;
  /** cited block inside the page */
  blockId?: string;
}

/** the agent step row: "Searching" → "Searched", "Creating pages" → "Created 1 page". */
export interface StepEvent {
  id: string;
  tool: string;
  status: 'running' | 'waiting' | 'done' | 'error' | 'declined';
  label: string;
  detail?: string;
  refs?: StepRef[];
  approval?: ApprovalPayload;
  error?: string;
  /** MCP tool calls: server name, input and response (Input / Response tabs) */
  mcp?: { server: string; tool: string; input?: string; output?: string };
}

/** What the approval card shows ("Do you want to continue?" · Reject / Continue). */
export interface ApprovalPayload {
  id: string;
  title: string;
  description?: string;
  /** new content preview (Markdown) */
  markdown?: string;
  /** removed content (Markdown of the replaced blocks) */
  removed?: string[];
  properties?: { name: string; value: string }[];
  pages?: StepRef[];
  plan?: { title: string; steps: string[] };
  confirmLabel?: string;
  danger?: boolean;
}

export type Risk = 'edit' | 'share' | 'destructive' | 'plan';

export interface ApprovalRequest {
  tool: string;
  stepId: string;
  risk: Risk;
  payload: Omit<ApprovalPayload, 'id'>;
}

export interface AgentEnv {
  userId: string;
  spaceId: string;
  threadId: string | null;
  /** id of the assistant turn (groups the turn's changes for Undo) */
  turnId: string;
  /** page the chat is about (panel on a page), used as default context */
  currentPageId?: string | null;
  approvalMode: ApprovalMode;
  clientId?: string;
  /** stable citation numbers ("[n]") for pages / URLs used by tools */
  cite(ref: StepRef): number;
  step(e: StepEvent): void;
  /** ask the user (resolves 'accept' when no approval is needed) */
  approve(req: ApprovalRequest): Promise<'accept' | 'decline'>;
  /** the turn touched these pages (Changes made card) */
  touched(pages: TouchedPage[]): void;
  /** Settings → AI → Enable Memories */
  memories: boolean;
  /** commit source of the writes (Custom Agent runs: "agent:<runId>" — their own edits never re-trigger them) */
  source?: string;
  /** chat "Sources" limited to a page (and its sub-pages) or a teamspace: workspace search stays inside it */
  searchScope?: { pageId?: string; teamId?: string };
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
}

export type ToolRun = (env: AgentEnv, input: Record<string, any>, stepId: string) => Promise<ToolOutput>;

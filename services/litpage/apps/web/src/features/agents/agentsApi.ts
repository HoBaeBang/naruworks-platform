// Custom Agents client state: the agents shared with me in the current workspace (sidebar Agents section, Library ›
// Agents, @-mentions), the open agent's detail (settings, Tools and access, sharing) and thin API wrappers. Agent
// records ("workflow" table) arrive through record maps and realtime pushes; the lists refresh when one changes.
import { create } from 'zustand';
import type { AgentConfig, AgentRecord, AgentRole, GrantRole, McpToolMode, PausedReason } from '@nc/shared/agents.ts';
import { compactId, expandId } from '@nc/shared/ids.ts';
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';

export interface AgentSummary {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  botId: string;
  role: AgentRole | 'none';
  status: 'active' | 'disabled' | 'paused';
  pausedReason: PausedReason | null;
  published: boolean;
  hasDraft: boolean;
  createdBy: string;
  createdTime: number;
  lastRunTime: number | null;
  favorite: boolean;
  visited: number | null;
  alive: boolean;
  triggers: number;
  connections: ('litpage' | 'web' | 'mcp' | 'agents' | 'people')[];
}

export interface GrantRow {
  blockId: string;
  role: GrantRole;
  title: string;
  icon: string | null;
  database: boolean;
  missing: boolean;
  canOpen: boolean;
  addedBy: string | null;
  revoked: { by: string; byName: string; time: number } | null;
}

export interface McpToolRow {
  name: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  openWorld: boolean;
  enabled: boolean;
  mode: McpToolMode;
}

export interface ConnectionRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  addedBy: string | null;
  addedByName: string;
  mine: boolean;
  
  workspaceManaged?: boolean;
  
  error?: string | null;
  checkedTime?: number | null;
  tools: McpToolRow[];
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

export interface SharingRow {
  type: 'user_permission' | 'group_permission' | 'space_permission';
  userId?: string;
  groupId?: string;
  name: string;
  email?: string | null;
  memberCount?: number;
  role: AgentRole;
  guest?: boolean;
}

export interface ModelRow {
  id: string;
  name: string;
  version: string;
  group: 'recommended' | 'other';
  beta: boolean;
  description: string;
  allowed: boolean;
}

export interface AgentDetail {
  agent: AgentSummary;
  role: AgentRole;
  config: AgentConfig;
  live: AgentConfig;
  changes: { kind: string; label: string }[];
  grants: GrantRow[];
  subAgents: { id: string; name: string; icon: string | null; canOpen: boolean; alive: boolean }[];
  connections: ConnectionRow[];
  nextRuns: Record<string, string | null>;
  triggerTargets: Record<string, { blockId: string; title: string; canOpen: boolean } | null>;
  sharing: SharingRow[];
  warnings: { privatePages: string[]; workspaceAccess: boolean; connections: string[]; web: boolean };
  models: ModelRow[];
  defaultModel: string;
  available: boolean;
  aiEnabled: boolean;
  webAllowed: boolean;
  webConfirm: boolean;
  configured: boolean;
  accessProblem: string | null;
  heldRuns: number;
  activeRuns: number;
  credits: { used: number; limit: number | null; owner: string | null; ownerName: string };
  instructionsPageId: string | null;
  isAdmin: boolean;
  
  orphan: { daysRemaining: number; disableTime: number } | null;
}

export interface NoAccessDetail {
  noAccess: true;
  admin: boolean;
  name: string;
  icon: string | null;
  owners: { id: string; name: string }[];
  triggerCount: number;
  status: string;
  agentId: string;
  spaceId: string;
}

export interface ResourceHit {
  blockId: string;
  title: string;
  icon: string | null;
  database: boolean;
  collectionId: string | null;
  maxRole: GrantRole;
}

export interface RunJson {
  id: string;
  kind: 'chat' | 'trigger' | 'manual' | 'sub_agent';
  status: 'pending' | 'running' | 'success' | 'skipped' | 'failed' | 'needs_review' | 'stopped';
  triggerLabel: string;
  triggerType: string | null;
  actorId: string | null;
  actorName: string;
  pageId: string | null;
  pageTitle: string | null;
  error: string | null;
  createdTime: number;
  startedTime: number | null;
  endedTime: number | null;
  model: string | null;
  credits: number;
  tools: string[];
  changes: number;
  result: string | null;
  threadId: string | null;
  feedback: { rating: 'positive' | 'negative'; comment: string | null } | null;
  review: { kind: 'url' | 'tool'; url?: string; host?: string; tool?: string; label: string; reason?: string; decided?: 'allow' | 'deny' } | null;
  held: boolean;
  text: string | null;
}


export function agentUrl(id: string, tab?: string): string {
  return `/agent/${compactId(id)}${tab ? `?tab=${tab}` : ''}`;
}

export function openAgent(id: string, tab?: string, opts?: { newTab?: boolean }) {
  if (opts?.newTab) window.open(agentUrl(id, tab), '_blank');
  else navigate(agentUrl(id, tab));
}

export function agentIdFromParam(v: string): string {
  return expandId(v);
}

interface AgentsState {
  spaceId: string | null;
  agents: AgentSummary[];
  loaded: boolean;
  available: boolean;
  canCreate: boolean;
  createProblem: string | null;
  isAdmin: boolean;
  load: (spaceId: string, force?: boolean) => Promise<void>;
  patch: (id: string, p: Partial<AgentSummary>) => void;
}

let inflight: Promise<void> | null = null;
let lastLoad = 0;

export const useAgents = create<AgentsState>((set, get) => ({
  spaceId: null,
  agents: [],
  loaded: false,
  available: false,
  canCreate: false,
  createProblem: null,
  isAdmin: false,
  load: async (spaceId, force) => {
    if (!spaceId) return;
    if (!force && get().spaceId === spaceId && get().loaded && Date.now() - lastLoad < 15_000) return;
    if (inflight && !force) return inflight;
    inflight = api<{ agents: AgentSummary[]; recordMap: any; available: boolean; canCreate: boolean; createProblem: string | null; isAdmin: boolean }>('getAgents', { spaceId })
      .then((r) => {
        mergeQuietly(r.recordMap);
        lastLoad = Date.now();
        set({ spaceId, agents: r.agents, loaded: true, available: r.available, canCreate: r.canCreate, createProblem: r.createProblem, isAdmin: r.isAdmin });
      })
      .catch(() => set({ spaceId, loaded: true }))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
  patch: (id, p) => set({ agents: get().agents.map((a) => (a.id === id ? { ...a, ...p } : a)) }),
}));

// any agent record change pushed by the server (save, share, rename, status) refreshes the list — not the record
// maps this module merges itself
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let quiet = false;
function mergeQuietly(rm: any) {
  quiet = true;
  try {
    records.mergeRecordMap(rm);
  } finally {
    quiet = false;
  }
}
records.subscribeAll((keys: string[]) => {
  if (quiet || !keys.some((k) => k.startsWith('workflow:'))) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const sid = useSession.getState().spaceId;
    if (sid) void useAgents.getState().load(sid, true);
  }, 300);
});


export function agentRecord(id: string | null | undefined): AgentRecord | undefined {
  return records.get<AgentRecord>('workflow', id);
}

export function toastError(e: unknown, fallback = 'Something went wrong while processing that request. Try again.') {
  useUI.getState().toast((e as Error)?.message || fallback);
}

// ---------------------------------------------------------------- API wrappers


export interface AgentAnalyticsData {
  days: number;
  agents: { id: string; name: string; icon: string | null; status: string; ownerName: string; runs: number; chats: number; failed: number; people: number; credits: number; lastRunTime: number | null }[];
  totals: { agents: number; used: number; runs: number; chats: number; credits: number };
}

export const agentApi = {
  get: (agentId: string) => api<AgentDetail | NoAccessDetail>('getAgent', { agentId }),
  templates: () => api<{ categories: { id: string; label: string }[]; templates: { id: string; title: string; description: string; icon: string; categories: string[]; badge: string | null }[] }>('listAgentTemplates', {}),
  create: (spaceId: string, opts: { templateId?: string; name?: string; icon?: string } = {}) => api<{ agentId: string; recordMap: any }>('createAgent', { spaceId, ...opts }),
  updateDraft: (agentId: string, patch: Partial<AgentConfig>) => api<AgentDetail & { recordMap: any }>('updateAgentDraft', { agentId, patch }),
  save: (agentId: string) => api<AgentDetail & { recordMap: any }>('saveAgent', { agentId }),
  discard: (agentId: string) => api<AgentDetail & { recordMap: any }>('discardAgentDraft', { agentId }),
  duplicate: (agentId: string) => api<{ agentId: string; recordMap: any; dropped: { grants: number; triggers: number } }>('copyAgent', { agentId }),
  remove: (agentId: string) => api('deleteAgent', { agentId }),
  restore: (agentId: string) => api('restoreAgent', { agentId }),
  permanentlyDelete: (agentId: string) => api('permanentlyDeleteAgent', { agentId }),
  sharing: (agentId: string) => api<{ sharing: SharingRow[]; role: AgentRole; groups: { id: string; name: string; memberCount: number }[]; warnings: AgentDetail['warnings']; recordMap: any }>('getAgentSharing', { agentId }),
  setPermissions: (agentId: string, permissions: unknown[]) => api<{ sharing: SharingRow[]; recordMap: any }>('setAgentPermissions', { agentId, permissions }),
  run: (agentId: string, text?: string, pageId?: string) => api<{ run: RunJson }>('runAgent', { agentId, text, pageId }),
  runs: (agentId: string, status?: string, before?: number) => api<{ runs: RunJson[]; role: AgentRole }>('getAgentRuns', { agentId, status, before }),
  runDetail: (runId: string) => api<{ run: RunJson; messages: any[] }>('getAgentRun', { runId }),
  stopRun: (runId: string) => api('stopAgentRun', { runId }),
  stopAll: (agentId: string) => api<{ stopped: number }>('stopAllAgentRuns', { agentId }),
  feedback: (runId: string, rating: 'positive' | 'negative' | null, comment?: string) => api('agentRunFeedback', { runId, rating, comment }),
  resolveReview: (runId: string, decision: 'allow' | 'deny') => api<{ ok: boolean; run?: RunJson }>('resolveAgentReview', { runId, decision }),
  resume: (agentId: string) => api<{ ok: boolean; resumed: number }>('resumeAgent', { agentId }),
  setEnabled: (agentId: string, enabled: boolean) => api<{ ok: boolean; status: string }>('setAgentEnabled', { agentId, enabled }),
  insights: (agentId: string, days: number) => api<any>('getAgentInsights', { agentId, days }),
  exportCsv: (agentId: string, days: number) => api<{ filename: string; csv: string }>('exportAgentRunsCsv', { agentId, days }),
  versions: (agentId: string) => api<{ versions: { id: string; createdTime: number; createdBy: string | null; createdByName: string; changes: { kind: string; label: string }[]; name: string }[] }>('getAgentVersions', { agentId }),
  restoreVersion: (agentId: string, versionId: string) => api<AgentDetail & { recordMap: any }>('restoreAgentVersion', { agentId, versionId }),
  favorite: (agentId: string, favorite: boolean) => api('setAgentFavorite', { agentId, favorite }),
  searchResources: (spaceId: string, query: string, kind?: 'page' | 'database') => api<{ results: ResourceHit[] }>('searchAgentResources', { spaceId, query, kind }),
  pageAgents: (pageId: string) => api<{ agents: { agentId: string; name: string; icon?: string; role: string; direct: boolean; viaWorkspace: boolean; canOpen: boolean }[]; available: { agentId: string; name: string; icon: string | null }[]; myRole: string }>('getPageAgents', { pageId }),
  grantPage: (agentId: string, pageId: string, role: GrantRole) => api('grantAgentPageAccess', { agentId, pageId, role }),
  revokePage: (agentId: string, pageId: string) => api('revokeAgentPageAccess', { agentId, pageId }),
  checkMention: (agentId: string, pageId: string) => api<{ disabled: boolean; listens: boolean; reachable: boolean; canGrant: boolean; canEdit: boolean; grantRole?: GrantRole }>('checkAgentMention', { agentId, pageId }),
  addConnection: (agentId: string, input: { name?: string; url?: string; token?: string; presetId?: string }) => api<AgentDetail>('addAgentConnection', { agentId, ...input }),
  presets: (spaceId: string) => api<{ presets: McpPreset[]; canManage: boolean }>('mcpListPresets', { spaceId }),
  refreshConnection: (agentId: string, connectionId: string) => api<AgentDetail>('refreshAgentConnection', { agentId, connectionId }),
  updateConnection: (agentId: string, connectionId: string, patch: { enabled?: boolean; disabledTools?: string[]; toolModes?: Record<string, McpToolMode> }) => api<AgentDetail>('updateAgentConnection', { agentId, connectionId, ...patch }),
  removeConnection: (agentId: string, connectionId: string) => api<AgentDetail>('removeAgentConnection', { agentId, connectionId }),
  setCreditLimit: (agentId: string, limit: number | null) => api<{ credits: { used: number; limit: number | null } }>('setAgentCreditLimit', { agentId, limit }),
  adminList: (spaceId: string, query?: string) => api<any>('adminListAgents', { spaceId, query }),
  adminResources: (agentId: string) => api<any>('adminAgentResources', { agentId }),
  adminAnalytics: (spaceId: string, days: number) => api<AgentAnalyticsData>('adminAgentAnalytics', { spaceId, days }),
  adminRevoke: (agentId: string, blockId: string) => api('adminRevokeAgentResource', { agentId, blockId }),
  transfer: (agentId: string, userId: string) => api<{ ok: boolean; ownerName: string }>('transferAgentOwnership', { agentId, userId }),
  orphaned: (spaceId: string, userId?: string) => api<{ agents: { id: string; name: string; icon: string | null; owner: string | null; ownerName: string; disableTime: number | null; status: string }[] }>('adminOrphanedAgents', { spaceId, userId }),
  adminJoin: (agentId: string) => api('adminJoinAgent', { agentId }),
  chats: (agentId: string) => api<{ chats: { id: string; title: string; updatedTime: number; unread: boolean }[] }>('getAgentChats', { agentId }),
  undo: (messageId: string) => api<{ reverted: number; conflicts: number; changes?: any }>('agentUndoChanges', { messageId }),
};


export function applyAnswer(r: { recordMap?: any } | undefined) {
  if (r?.recordMap) mergeQuietly(r.recordMap);
  const sid = useSession.getState().spaceId;
  if (sid) void useAgents.getState().load(sid, true);
}

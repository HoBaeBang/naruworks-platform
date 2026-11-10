// AI policy: workspace switches (Settings → AI → Workspace settings / Model controls; owners and
// admins write space.settings.ai_*) and the member's own AI preferences (user_settings.settings.ai_*). Every AI
// endpoint reads them at request time so a change applies to the next request without a restart.
import type { SpaceRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { getRecord } from '../db.ts';

export type ApprovalMode = 'always_ask' | 'review_for_me' | 'skip_all';

export interface WorkspaceAiPolicy {
  /** "Enable AI". Off disables every AI surface for the workspace. */
  enabled: boolean;
  /** "Enable web search for workspace" */
  webSearch: boolean;
  /** "Require confirmation for web requests": web pages are not opened without the user (web_fetch is withheld) */
  webConfirm: boolean;
  /** "Enable ‘Skip all approvals’" */
  skipApprovals: boolean;
  /** "Enable custom MCP servers" */
  customMcp: boolean;
  /** approved custom MCP server URL patterns — "*" one path segment, "**" deeper paths */
  mcpAllowlist: string[];
  /** the approved list is in effect (space.settings.ai_mcp_allowlist_enabled; without that key: when the list isn't
   *  empty) — on with an empty list, no custom MCP server is allowed */
  mcpAllowlistOn: boolean;
  /** "Allowed models for Agent" (empty = all) */
  allowedModels: string[];
  /** "Enable Memories" — the agent may append to the member's instructions page */
  memories: boolean;
  /** "Enable skills over MCP" */
  mcpSkills: boolean;
  /** "Allow local skill downloads" (SKILL.md download) */
  localSkills: boolean;
  /** MCP server reachable for this workspace (Settings → MCP) */
  litMcp: boolean;
  /** Settings → AI → Claude Fable 5 (admin opt-in) */
  fable: boolean;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 300).slice(0, 200) : [];
}

export function workspaceAiPolicy(spaceId: string | null | undefined): WorkspaceAiPolicy {
  const s = ((spaceId ? getRecord<SpaceRecord>('space', spaceId)?.settings : undefined) ?? {}) as Record<string, unknown>;
  return {
    enabled: bool(s.ai_enabled, true),
    webSearch: bool(s.ai_web_search, true),
    webConfirm: bool(s.ai_web_confirm, false),
    skipApprovals: bool(s.ai_skip_approvals, true),
    customMcp: bool(s.ai_custom_mcp, true),
    mcpAllowlist: strings(s.ai_mcp_allowlist),
    mcpAllowlistOn: typeof s.ai_mcp_allowlist_enabled === 'boolean' ? s.ai_mcp_allowlist_enabled : strings(s.ai_mcp_allowlist).length > 0,
    allowedModels: strings(s.ai_allowed_models),
    memories: bool(s.ai_memories, true),
    mcpSkills: bool(s.ai_mcp_skills, true),
    localSkills: bool(s.ai_local_skills, true),
    litMcp: bool(s.lit_mcp_enabled, true),
    fable: bool(s.ai_fable_enabled, false),
  };
}

export interface UserAiPrefs {
  /** "Web" in the chat's + menu stays on for new chats ("Always allow") */
  web: boolean;
  approvalMode: ApprovalMode;
  model: string;
  /** user skills (page ids) enabled for this member ("Enabled for me") */
  skills: string[];
  /** skills the member chose to hide (built-in or workspace defaults) */
  skillsOff: string[];
}

export function userAiPrefs(userId: string): UserAiPrefs {
  const s = ((getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>);
  const mode = s.ai_approval_mode;
  return {
    web: bool(s.ai_web, false),
    approvalMode: mode === 'always_ask' || mode === 'skip_all' ? mode : 'review_for_me',
    model: typeof s.ai_model === 'string' ? s.ai_model : 'auto',
    skills: strings(s.ai_skills_enabled),
    skillsOff: strings(s.ai_skills_disabled),
  };
}

/** The approval mode a request may use: "Skip all approvals" needs the workspace switch. */
export function effectiveApprovalMode(requested: unknown, policy: WorkspaceAiPolicy): ApprovalMode {
  const m: ApprovalMode = requested === 'always_ask' || requested === 'skip_all' ? requested : 'review_for_me';
  if (m === 'skip_all' && !policy.skipApprovals) return 'review_for_me';
  return m;
}

/** May members use this custom MCP server URL (the approved list, when it is in effect)? */
export function mcpServerAllowed(policy: WorkspaceAiPolicy, url: string): boolean {
  if (!policy.mcpAllowlistOn) return true;
  return policy.mcpAllowlist.length > 0 && mcpUrlAllowed(url, policy.mcpAllowlist);
}

/** Why an approved-list entry is refused, or null when it is allowed. */
export function mcpAllowlistProblem(raw: string, list: string[] = []): string | null {
  const v = raw.trim();
  if (!v) return 'Enter an MCP server URL or URL pattern.';
  if (!/^https:\/\//i.test(v)) return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? 'Only HTTPS URLs are allowed.' : 'URL patterns must start with https://.';
  const host = /^https:\/\/([^/]*)/i.exec(v)?.[1] ?? '';
  if (host.includes('*')) return 'Use wildcards in the URL path only, such as https://mcp.example.com/*.';
  let u: URL;
  try {
    u = new URL(v.replace(/\*/g, 'x'));
  } catch {
    return 'Enter a valid URL.';
  }
  if (u.username || u.password || !u.hostname) return 'Enter a valid URL.';
  if (!v.slice(`https://${host}`.length).replace(/^\/+/, '')) return 'Add a path after the domain, such as https://mcp.example.com/*.';
  if (list.some((x) => x.trim().toLowerCase() === v.toLowerCase())) return 'That URL pattern is already on the list.';
  return null;
}

/** Custom MCP URL allowed by the workspace allowlist ("*" = one path segment, "**" = deeper paths; host exact). */
export function mcpUrlAllowed(url: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const target = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  return allowlist.some((pattern) => {
    let p: URL;
    try {
      p = new URL(pattern.replace(/\*\*/g, '__DS__').replace(/\*/g, '__S__'));
    } catch {
      return false;
    }
    if (p.protocol !== u.protocol || p.host !== u.host) return false;
    const path = p.pathname.replace(/\/+$/, '');
    const re = new RegExp(`^${path.split(/(__DS__|__S__)/).map((part) => (part === '__DS__' ? '.*' : part === '__S__' ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
    return re.test(target.slice(`${u.protocol}//${u.host}`.length) || '');
  });
}

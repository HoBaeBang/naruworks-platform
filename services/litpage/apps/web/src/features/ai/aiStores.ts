
// Skills, the selection menu, and the user's MCP connections from Connections in Settings.
import { create } from 'zustand';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';

export interface SkillInfo {
  id: string;
  pageId: string | null;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  mine: boolean;
  automatic: boolean;
  inChat: boolean;
  inPage: boolean;
  icon: string | null;
  updatedTime: number | null;
  createdBy: string;
}

interface SkillsState {
  enabled: SkillInfo[];
  discover: SkillInfo[];
  loadedFor: string | null;
  loading: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
}

// Callers awaiting load() while a request is in flight share the same promise; lists older than
// SKILLS_MAX_AGE are fetched again to include skills created elsewhere.
let skillsInflight: { spaceId: string; promise: Promise<void> } | null = null;
let skillsLoadedAt = 0;
const SKILLS_MAX_AGE = 15_000;

export const useSkills = create<SkillsState>((set, get) => ({
  enabled: [],
  discover: [],
  loadedFor: null,
  loading: false,
  error: null,
  async load(force) {
    const spaceId = useSession.getState().spaceId;
    if (!spaceId || (!force && get().loadedFor === spaceId && Date.now() - skillsLoadedAt < SKILLS_MAX_AGE)) return;
    if (skillsInflight?.spaceId === spaceId && !force) return skillsInflight.promise;
    const entry: { spaceId: string; promise: Promise<void> } = { spaceId, promise: Promise.resolve() };
    entry.promise = (async () => {
      set({ loading: true });
      try {
        const r = await api<{ enabled: SkillInfo[]; discover: SkillInfo[] }>('aiListSkills', { spaceId });
        if (useSession.getState().spaceId === spaceId) {
          skillsLoadedAt = Date.now();
          set({ enabled: r.enabled, discover: r.discover, loadedFor: spaceId, error: null });
        }
      } catch (e) {
        set({ error: (e as Error)?.message || 'Could not load skills.' });
      } finally {
        set({ loading: false });
        if (skillsInflight === entry) skillsInflight = null;
      }
    })();
    skillsInflight = entry;
    return entry.promise;
  },
}));

export async function setSkillEnabled(skill: SkillInfo, enabled: boolean) {
  const spaceId = useSession.getState().spaceId;
  await api('aiSetSkillEnabled', { spaceId, skillId: skill.id, enabled });
  await useSkills.getState().load(true);
}

export async function setSkillAutomatic(skill: SkillInfo, automatic: boolean) {
  const spaceId = useSession.getState().spaceId;
  await api('aiSetSkillAutomatic', { spaceId, skillId: skill.id, automatic });
  await useSkills.getState().load(true);
}


export async function useAsSkill(pageId: string) {
  try {
    await api('aiRegisterSkill', { pageId });
    void useSkills.getState().load(true);
    useUI.getState().toast('Skill enabled. Your Agent can now use this skill. Type / in chat to use it.');
  } catch (e) {
    useUI.getState().toast((e as Error)?.message || 'Could not create skill');
  }
}

export async function unsetSkill(pageId: string) {
  await api('aiUnsetSkill', { pageId });
  await useSkills.getState().load(true);
}

export interface McpTool {
  name: string;
  description?: string;
  readOnly?: boolean;
  destructive?: boolean;
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
}

interface ConnectionsState {
  list: McpConnection[];
  customMcp: boolean;
  loadedFor: string | null;
  
  off: Set<string>;
  load: (force?: boolean) => Promise<void>;
  toggle: (id: string) => void;
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  list: [],
  customMcp: true,
  loadedFor: null,
  off: new Set(),
  async load(force) {
    const spaceId = useSession.getState().spaceId;
    if (!spaceId || (!force && get().loadedFor === spaceId)) return;
    try {
      const r = await api<{ connections: McpConnection[]; customMcp: boolean }>('aiListConnections', { spaceId });
      set({ list: r.connections, customMcp: r.customMcp, loadedFor: spaceId });
    } catch {
      
    }
  },
  toggle(id) {
    const off = new Set(get().off);
    if (off.has(id)) off.delete(id);
    else off.add(id);
    set({ off });
  },
}));


export function activeConnectionIds(): string[] {
  const s = useConnections.getState();
  return s.list.filter((c) => c.enabled && !s.off.has(c.id)).map((c) => c.id);
}

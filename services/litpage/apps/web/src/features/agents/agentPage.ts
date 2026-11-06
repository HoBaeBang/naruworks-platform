// State of the open agent page (/agent/<id>): the detail answer (settings, access, sharing…), the settings panel and
// the tab. The shell's topbar (crumbs + actions) and the page body both read it. Settings edits go to the server as

import { create } from 'zustand';
import type { AgentConfig } from '@nc/shared/agents.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { agentApi, applyAnswer, toastError, useAgents, type AgentDetail, type NoAccessDetail } from './agentsApi.ts';

export type AgentTab = 'chat' | 'activity' | 'insights';

interface AgentPageState {
  agentId: string | null;
  detail: AgentDetail | null;
  noAccess: NoAccessDetail | null;
  error: string | null;
  settingsOpen: boolean;
  tab: AgentTab;
  saving: boolean;
  open: (agentId: string) => Promise<void>;
  refresh: () => Promise<void>;
  setDetail: (d: AgentDetail) => void;
  setSettingsOpen: (v: boolean) => void;
  setTab: (tab: AgentTab) => void;
  update: (patch: Partial<AgentConfig>) => Promise<boolean>;
  save: () => Promise<boolean>;
  discard: () => Promise<void>;
  close: () => void;
}

function readSettingsPref(agentId: string): boolean | null {
  try {
    const v = localStorage.getItem(`nc:agent-settings:${agentId}`);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export const useAgentPage = create<AgentPageState>((set, get) => ({
  agentId: null,
  detail: null,
  noAccess: null,
  error: null,
  settingsOpen: true,
  tab: 'chat',
  saving: false,
  open: async (agentId) => {
    if (get().agentId !== agentId) set({ agentId, detail: null, noAccess: null, error: null });
    try {
      const r = await agentApi.get(agentId);
      if (get().agentId !== agentId) return;
      if ((r as NoAccessDetail).noAccess) {
        set({ noAccess: r as NoAccessDetail, detail: null });
        return;
      }
      const d = r as AgentDetail & { recordMap?: any };
      applyAnswer(d);
      const pref = readSettingsPref(agentId);
      const editor = d.role === 'editor' || d.role === 'read_and_write';
      set({ detail: d, noAccess: null, settingsOpen: pref ?? (editor || !d.agent.published) });
    } catch (e) {
      if (get().agentId === agentId) set({ error: (e as { status?: number })?.status === 404 ? 'notfound' : (e as Error)?.message || 'error' });
    }
  },
  refresh: async () => {
    const id = get().agentId;
    if (!id) return;
    try {
      const r = await agentApi.get(id);
      if (get().agentId !== id || (r as NoAccessDetail).noAccess) return;
      set({ detail: r as AgentDetail });
    } catch {
      
    }
  },
  setDetail: (d) => set({ detail: d }),
  setSettingsOpen: (v) => {
    const id = get().agentId;
    try {
      if (id) localStorage.setItem(`nc:agent-settings:${id}`, v ? '1' : '0');
    } catch {
      
    }
    set({ settingsOpen: v });
  },
  setTab: (tab) => set({ tab }),
  update: async (patch) => {
    const id = get().agentId;
    const d = get().detail;
    if (!id || !d) return false;
    // optimistic: the panel shows the edit right away
    set({ detail: { ...d, config: { ...d.config, ...patch } } });
    try {
      const r = await agentApi.updateDraft(id, patch);
      applyAnswer(r);
      if (get().agentId === id) set({ detail: r });
      return true;
    } catch (e) {
      toastError(e, t('lp.agents.couldn_t_update_agent', 'Couldn’t update agent'));
      if (get().agentId === id) set({ detail: d });
      return false;
    }
  },
  save: async () => {
    const id = get().agentId;
    if (!id || get().saving) return false;
    set({ saving: true });
    try {
      const r = await agentApi.save(id);
      applyAnswer(r);
      set({ detail: r, saving: false });
      useUI.getState().toast(t('lp.agents.agent_saved_successfully', 'Agent changes saved'));
      return true;
    } catch (e) {
      set({ saving: false });
      toastError(e, t('lp.agents.couldn_t_update_agent', 'Couldn’t update agent'));
      return false;
    }
  },
  discard: async () => {
    const id = get().agentId;
    if (!id) return;
    try {
      const r = await agentApi.discard(id);
      applyAnswer(r);
      set({ detail: r });
      useUI.getState().toast(t('lp.agents.changes_discarded', 'Changes discarded'));
    } catch (e) {
      toastError(e, t('lp.agents.your_changes_weren_t_discarded_try', 'Your changes weren’t discarded. Try again.'));
    }
  },
  close: () => set({ agentId: null, detail: null, noAccess: null, error: null }),
}));


export function canEditAgent(d: AgentDetail | null | undefined): boolean {
  return !!d && (d.role === 'editor' || d.role === 'read_and_write') && d.agent.alive;
}

export function refreshAgentList() {
  const sid = useSession.getState().spaceId;
  if (sid) void useAgents.getState().load(sid, true);
}

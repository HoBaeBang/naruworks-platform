// Workspace sidebar presets (Settings › Sidebar): tab templates an admin arranges into
// Default (every member who hasn't customized their sidebar starts with these tabs, in order) and Optional
// (members can add them with "Add tab"). The built-in presets (Home, Chat, Meetings) can be previewed and duplicated
// but not edited, renamed or deleted. Stored on space.settings.sidebar_presets (admin-only write, server-checked).
import type { SpaceRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { defaultLayout, type SidebarLayout, type SidebarSection, type SidebarShortcut, type SidebarTab, type TabIcon } from '../shell/sidebar/model.ts';

export interface SidebarPreset {
  id: string;
  name?: string;
  icon: TabIcon;
  shortcuts: SidebarShortcut[];
  sections: SidebarSection[];
  created_by_id?: string;
  created_time?: number;
  /** built-in preset (not stored) */
  litpage?: boolean;
}

export interface SidebarPresetConfig {
  presets: SidebarPreset[];
  default: string[];
  optional: string[];
}

export const MAX_WORKSPACE_PRESETS = 20;
export const MAX_DEFAULT_PRESETS = 6;

/** Built-in presets: the standard Home / Chat / Meetings tabs. */
export function litPresets(): SidebarPreset[] {
  return defaultLayout().tabs.map((tab) => ({ id: `litpage:${tab.id}`, icon: tab.icon, shortcuts: tab.shortcuts, sections: tab.sections, litpage: true }));
}

export function presetConfig(space: SpaceRecord | undefined): SidebarPresetConfig {
  const raw = (space?.settings as Record<string, unknown> | undefined)?.sidebar_presets as Partial<SidebarPresetConfig> | undefined;
  const custom = Array.isArray(raw?.presets) ? raw!.presets.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.shortcuts) && Array.isArray(p.sections)) : [];
  const known = new Set([...litPresets().map((p) => p.id), ...custom.map((p) => p.id)]);
  const def = Array.isArray(raw?.default) ? raw!.default.filter((id) => known.has(id)) : litPresets().map((p) => p.id);
  const opt = Array.isArray(raw?.optional) ? raw!.optional.filter((id) => known.has(id) && !def.includes(id)) : [];
  return { presets: custom, default: def, optional: opt };
}

export function allPresets(cfg: SidebarPresetConfig): SidebarPreset[] {
  return [...litPresets(), ...cfg.presets];
}

export function presetById(cfg: SidebarPresetConfig, id: string): SidebarPreset | undefined {
  return allPresets(cfg).find((p) => p.id === id);
}

/** A preset as a member's sidebar tab (fresh ids for its shortcuts and sections). */
export function presetTab(p: SidebarPreset, keepIds = false): SidebarTab {
  const tabId = p.litpage ? p.id.replace(/^litpage:/, '') : keepIds ? p.id : `tab-${newId().slice(0, 8)}`;
  return {
    id: tabId,
    icon: p.icon,
    name: p.name || undefined,
    shortcuts: p.shortcuts.map((s) => ({ ...s, id: keepIds || p.litpage ? s.id : `sc-${newId().slice(0, 8)}` })),
    sections: p.sections.map((s) => ({ ...s, id: keepIds || p.litpage ? s.id : `sec-${newId().slice(0, 8)}` })),
  };
}

/** Sidebar of a member who hasn't customized theirs: the workspace's Default presets (null = the built-in default). */
export function layoutFromPresets(space: SpaceRecord | undefined): SidebarLayout | null {
  const raw = (space?.settings as Record<string, unknown> | undefined)?.sidebar_presets;
  if (!raw) return null;
  const cfg = presetConfig(space);
  const tabs = cfg.default.map((id) => presetById(cfg, id)).filter((p): p is SidebarPreset => !!p).slice(0, MAX_DEFAULT_PRESETS).map((p) => presetTab(p, true));
  return tabs.length ? { version: 1, tabs } : null;
}

/** Optional presets a member can add from the sidebar's "Add tab" (sidebar menu). */
export function workspaceSidebarPresets(space: SpaceRecord | undefined): { default: SidebarPreset[]; optional: SidebarPreset[] } {
  const cfg = presetConfig(space);
  const pick = (ids: string[]) => ids.map((id) => presetById(cfg, id)).filter((p): p is SidebarPreset => !!p);
  return { default: pick(cfg.default), optional: pick(cfg.optional) };
}

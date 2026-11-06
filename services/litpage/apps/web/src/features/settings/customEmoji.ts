// Workspace custom emoji (Settings › Emoji) for the pickers: page icons, reactions and ":name" inline
// emoji. Stored on space.settings.custom_emojis = [{ id, name, url, created_by_id, created_time }] (server-validated in
// api/modules/workspace.ts addCustomEmoji / editCustomEmoji / removeCustomEmoji). The editor/picker integration
// reads these helpers; a custom emoji is referenced in content as ":name:" and rendered as an <img> with this url.
import { useMemo } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { useCurrentSpace } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';

export interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  created_by_id: string;
  created_time: number;
}

function listOf(space: SpaceRecord | undefined): CustomEmoji[] {
  const raw = (space?.settings as Record<string, unknown> | undefined)?.custom_emojis;
  return Array.isArray(raw) ? (raw as CustomEmoji[]).filter((e) => e && typeof e.name === 'string' && typeof e.url === 'string') : [];
}

/** Custom emoji of a workspace (default: the current one), newest first. */
export function getCustomEmojis(spaceId?: string | null): CustomEmoji[] {
  return listOf(records.get<SpaceRecord>('space', spaceId ?? useSession.getState().spaceId));
}

/** Re-renders when the workspace's emoji library changes. */
export function useCustomEmojis(): CustomEmoji[] {
  const space = useCurrentSpace();
  const raw = (space?.settings as Record<string, unknown> | undefined)?.custom_emojis;
  return useMemo(() => listOf(space), [raw]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Look up ":name:" (with or without the colons). */
export function customEmojiByName(name: string, spaceId?: string | null): CustomEmoji | undefined {
  const n = name.replace(/^:|:$/g, '').toLowerCase();
  return getCustomEmojis(spaceId).find((e) => e.name === n);
}

/** Search for pickers: prefix matches first, then substring matches. */
export function searchCustomEmojis(query: string, spaceId?: string | null): CustomEmoji[] {
  const q = query.trim().replace(/^:/, '').toLowerCase();
  const all = getCustomEmojis(spaceId);
  if (!q) return all;
  return [...all.filter((e) => e.name.startsWith(q)), ...all.filter((e) => !e.name.startsWith(q) && e.name.includes(q))];
}

/** Value stored as a page icon / reaction for a custom emoji: the image url. */
export function customEmojiIcon(e: CustomEmoji): string {
  return e.url;
}

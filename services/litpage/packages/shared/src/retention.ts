// Data retention (Settings › Security › Data retention). Every plan: a page stays in Trash for 30 days
// before it is deleted for good, and a deleted page is kept for another 30 days after it leaves Trash (owners of
// Enterprise workspaces find and restore it in Content search › Retained pages). Enterprise workspaces choose both
// numbers (space.settings.trash_retention_days / purge_retention_days). Server: apps/server/src/retention.ts; the
// Settings dropdowns, the Trash footer and the page's Trash banner show the same values.
import type { SpaceRecord } from './records.ts';

export const DEFAULT_RETENTION_DAYS = 30;

function customDays(space: SpaceRecord | undefined, key: string): number | null {
  const n = Number((space?.settings as Record<string, unknown> | undefined)?.[key]);
  return space?.plan_type === 'enterprise' && Number.isFinite(n) && n > 0 ? n : null;
}

/** Days a page stays in Trash before it is deleted for good. */
export function trashRetentionDays(space: SpaceRecord | undefined): number {
  return customDays(space, 'trash_retention_days') ?? DEFAULT_RETENTION_DAYS;
}

/** Days a page is kept after it leaves Trash ("Retention for deleted pages"). */
export function purgeRetentionDays(space: SpaceRecord | undefined): number {
  return customDays(space, 'purge_retention_days') ?? DEFAULT_RETENTION_DAYS;
}

// Extension points that block modules use to customize editor-core UI without editing it:
// - per-type first section of the block action menu (⋮⋮ / ⌘/ / •••), e.g. code: Caption, Copy code, Wrap code…
// - slash catalog overrides (how a slash item creates its block: callout v2, tab blocks, embed providers…)
// - "Turn into" overrides for targets that are not a plain type change (synced block wraps the blocks)
// Block menu entries are grouped by block type.
import type { BlockRecord } from '@nc/shared/records.ts';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import type { SlashContext, SlashItem } from '../slashItems.ts';

export interface BlockMenuContext {
  ids: string[];
  block: BlockRecord;
  /** the editor's default "Turn into ▸" item */
  turnInto: MenuItemDef;
  /** the editor's default "Color ▸" item */
  color: MenuItemDef;
  /** anchor of the menu (for follow-up popovers) */
  anchor?: DOMRect;
}

type MenuSectionFn = (ctx: BlockMenuContext) => MenuItemDef[];

/** Blocks that paint format.block_color themselves (the row wrapper in Block.tsx stays uncolored). */
export const SELF_COLORED_BLOCKS = new Set<string>(['callout', 'button']);

const menuSections = new Map<string, MenuSectionFn>();

/** Register the first section of the block menu for `types` (replaces the default Turn into / Color pair). */
export function registerBlockMenu(types: string[], fn: MenuSectionFn) {
  for (const t of types) menuSections.set(t, fn);
}

/** Items for the block menu's first section, or null when the type keeps the editor defaults. */
export function blockMenuItems(ctx: BlockMenuContext): MenuItemDef[] | null {
  const fn = menuSections.get(ctx.block.type);
  return fn ? fn(ctx) : null;
}

type DuplicateItemFn = (ctx: { ids: string[]; block: BlockRecord }) => MenuItemDef | null;
const duplicateItems = new Map<string, DuplicateItemFn>();

/** Replace the block menu's "Duplicate" item for `types`; return null to keep the default item. */
export function registerDuplicateItem(types: string[], fn: DuplicateItemFn) {
  for (const t of types) duplicateItems.set(t, fn);
}

export function blockDuplicateItem(ctx: { ids: string[]; block: BlockRecord }): MenuItemDef | null {
  const fn = ctx.ids.length === 1 ? duplicateItems.get(ctx.block.type) : undefined;
  return fn ? fn(ctx) : null;
}

type SlashApply = (ctx: SlashContext) => void;
const slashOverrides = new Map<string, SlashApply>();

/** Replace what the slash item with `id` (see slashItems.ts) does when chosen. */
export function overrideSlashItem(id: string, apply: SlashApply) {
  slashOverrides.set(id, apply);
}

const slashHidden = new Map<string, () => boolean>();

/** Leave the slash item with `id` out of the menu while `hidden` is true (a feature the workspace turned off). */
export function hideSlashItemWhen(id: string, hidden: () => boolean) {
  slashHidden.set(id, hidden);
}

export function applySlashOverrides<T extends { id: string; apply: SlashApply }>(items: T[]): T[] {
  if (!slashOverrides.size && !slashHidden.size) return items;
  return items.filter((it) => !slashHidden.get(it.id)?.()).map((it) => {
    const o = slashOverrides.get(it.id);
    return o ? { ...it, apply: o } : it;
  });
}

type ExtraSlashFn = () => SlashItem[];
const extraSlash: ExtraSlashFn[] = [];

/** Add slash items another area (AI image, skills …); called on every menu open so items can depend on state. * Items appear after the editor's own catalog in their `section` (a new section title when it is not an existing one). */
export function registerSlashItems(fn: ExtraSlashFn) {
  extraSlash.push(fn);
}

export function extraSlashItems(): SlashItem[] {
  const out: SlashItem[] = [];
  for (const fn of extraSlash) {
    try {
      out.push(...fn());
    } catch (e) {
      console.error('[slash] extra items failed', e);
    }
  }
  return out;
}

type TurnIntoFn = (ids: string[]) => void;
const turnIntoOverrides = new Map<string, TurnIntoFn>();

/** Custom "Turn into <type>" behavior (key = block type, or `type:toggleable` for toggle headings). */
export function registerTurnInto(key: string, fn: TurnIntoFn) {
  turnIntoOverrides.set(key, fn);
}

export function turnIntoOverride(type: string, format?: Record<string, unknown>): TurnIntoFn | undefined {
  if (format?.toggleable) return turnIntoOverrides.get(`${type}:toggleable`);
  return turnIntoOverrides.get(type);
}

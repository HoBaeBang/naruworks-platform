// Database page layouts: one layout per data source, applied to every page of it. Stored on
// collection.format.page_layout:
// structure 'simple' | 'tabbed', modules per area — page_main (the page) and page_details (the details panel)
// and page settings (inline comments, page discussions, property icons, full width, database templates).
// Modules: title ("Heading" + pinned properties), properties ("Property group", named sections),
// property (one property shown on its own), discussions ("Page discussions"), editor ("Content").
import type { PropertySchema } from '../records.ts';

export type LayoutArea = 'page_main' | 'page_details';

export interface TitleModule { id: string; type: 'title'; pinned: string[]; backlinks?: 'show' | 'hover' | 'off' }
export interface PropertySection { id: string; name?: string; properties: string[]; collapsed?: boolean }
export interface PropertiesModule { id: string; type: 'properties'; sections: PropertySection[]; hidden: string[] }
export interface PropertyModule { id: string; type: 'property'; property: string }
export interface DiscussionsModule { id: string; type: 'discussions' }
export interface EditorModule { id: string; type: 'editor' }
export type LayoutModule = TitleModule | PropertiesModule | PropertyModule | DiscussionsModule | EditorModule;

export interface PageLayoutSettings {
  inline_comments?: 'default' | 'minimal';
  page_discussions?: boolean;
  property_icons?: boolean;
  full_width?: boolean;
  database_templates?: boolean;
}

export interface PageLayout {
  structure: 'simple' | 'tabbed';
  modules: Record<LayoutArea, LayoutModule[]>;
  settings: PageLayoutSettings;
  /** tabbed: extra tabs after "Content" — a database view each (linked data source block on the page) */
  tabs?: { id: string; name: string; collection_id?: string; view_type?: string }[];
}

/** Pinned properties of the heading: up to 15. */
export const MAX_PINNED_PROPERTIES = 15;

/** Properties that can't be shown in a property group / module (shown by the page itself). */
export function layoutPropertyIds(schema: Record<string, PropertySchema>): string[] {
  return Object.keys(schema).filter((id) => id !== 'title' && schema[id]?.type !== 'title');
}

let seq = 0;
function lid(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The layout every database page has until someone customizes it (the original page layout). */
export function defaultPageLayout(schema: Record<string, PropertySchema>, order?: string[]): PageLayout {
  const ids = layoutPropertyIds(schema);
  const ordered = order ? [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))] : ids;
  return {
    structure: 'simple',
    modules: {
      page_main: [
        { id: 'title', type: 'title', pinned: [] },
        { id: 'properties', type: 'properties', sections: [{ id: 'default', properties: ordered }], hidden: [] },
        { id: 'discussions', type: 'discussions' },
        { id: 'editor', type: 'editor' },
      ],
      page_details: [],
    },
    settings: {},
  };
}

/**
 * The stored layout made consistent with the current schema: deleted properties dropped, new properties appended to
 * the property group's last section, exactly one heading (first) / property group / content / discussions module.
 */
export function normalizePageLayout(stored: unknown, schema: Record<string, PropertySchema>, order?: string[]): PageLayout {
  const base = defaultPageLayout(schema, order);
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<PageLayout>;
  const ids = new Set(layoutPropertyIds(schema));
  const placed = new Set<string>();
  const clean = (list: unknown): LayoutModule[] => {
    const out: LayoutModule[] = [];
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m !== 'object' || typeof (m as LayoutModule).type !== 'string') continue;
      const mod = m as LayoutModule;
      if (mod.type === 'title') {
        if (out.some((x) => x.type === 'title')) continue;
        const pinned = (Array.isArray(mod.pinned) ? mod.pinned : []).filter((p) => ids.has(p) && !placed.has(p)).slice(0, MAX_PINNED_PROPERTIES);
        pinned.forEach((p) => placed.add(p));
        out.push({ id: mod.id || 'title', type: 'title', pinned, ...(mod.backlinks ? { backlinks: mod.backlinks } : {}) });
      } else if (mod.type === 'property') {
        if (!ids.has(mod.property) || placed.has(mod.property)) continue;
        placed.add(mod.property);
        out.push({ id: mod.id || lid('prop'), type: 'property', property: mod.property });
      } else if (mod.type === 'properties' || mod.type === 'discussions' || mod.type === 'editor') {
        if (out.some((x) => x.type === mod.type)) continue;
        out.push(mod.type === 'properties' ? { ...mod, sections: Array.isArray(mod.sections) ? mod.sections : [], hidden: Array.isArray(mod.hidden) ? mod.hidden : [] } : { id: mod.id || mod.type, type: mod.type });
      }
    }
    return out;
  };
  // title first in the main area (it can't move or be removed)
  let main = clean(s.modules?.page_main);
  const details = clean(s.modules?.page_details).filter((m) => m.type !== 'title' && m.type !== 'editor');
  const titleIdx = main.findIndex((m) => m.type === 'title');
  const title = titleIdx >= 0 ? main.splice(titleIdx, 1)[0] : base.modules.page_main[0];
  main = [title, ...main];
  if (!main.some((m) => m.type === 'editor')) main.push({ id: 'editor', type: 'editor' });
  const all = [...main, ...details];
  // property group: sections keep known, unplaced properties; new properties land in the last section
  let group = all.find((m): m is PropertiesModule => m.type === 'properties');
  if (!group) {
    group = { id: 'properties', type: 'properties', sections: [{ id: 'default', properties: [] }], hidden: [] };
    main.splice(1, 0, group);
  }
  const inGroup = new Set<string>();
  group.sections = group.sections.filter((sec) => sec && Array.isArray(sec.properties)).map((sec) => ({
    ...sec,
    properties: sec.properties.filter((p) => {
      if (!ids.has(p) || placed.has(p) || inGroup.has(p)) return false;
      inGroup.add(p);
      return true;
    }),
  }));
  if (!group.sections.length) group.sections.push({ id: 'default', properties: [] });
  const rest = (order ?? []).filter((p) => ids.has(p)).concat([...ids]).filter((p, i, arr) => arr.indexOf(p) === i && !placed.has(p) && !inGroup.has(p));
  group.sections[group.sections.length - 1].properties.push(...rest);
  group.hidden = group.hidden.filter((p) => ids.has(p));
  return {
    structure: s.structure === 'tabbed' ? 'tabbed' : 'simple',
    modules: { page_main: main, page_details: details },
    settings: { ...(s.settings ?? {}) },
    ...(Array.isArray(s.tabs) ? { tabs: s.tabs.filter((t) => t && typeof t.id === 'string') } : {}),
  };
}

/** Whether a data source has a customized layout (vs. the original page layout). */
export function hasCustomLayout(format: Record<string, unknown> | undefined): boolean {
  return !!format?.page_layout;
}

/** Where a module lives. */
export function moduleArea(layout: PageLayout, id: string): LayoutArea | null {
  if (layout.modules.page_main.some((m) => m.id === id)) return 'page_main';
  if (layout.modules.page_details.some((m) => m.id === id)) return 'page_details';
  return null;
}

/** Modules that may go to the details panel (not the heading / content; relations stay on the page). */
export function canMoveToPanel(m: LayoutModule, schema: Record<string, PropertySchema>): boolean {
  if (m.type === 'title' || m.type === 'editor') return false;
  if (m.type === 'property') return schema[m.property]?.type !== 'relation';
  return true;
}

export function newLayoutModuleId(prefix = 'mod'): string {
  return lid(prefix);
}

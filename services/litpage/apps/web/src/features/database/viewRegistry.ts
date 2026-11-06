// View renderers keyed by collection_view.type (table, board, gallery, list, calendar, timeline, …).
// Files named *.view.tsx call registerView(type, Comp) and are auto-imported. Inside a view, the
// database chrome context (search, selection, peek mode, addRow, openRow, bleed) is available through
// useDatabaseContext() provides database context; rows come through useViewQuery() from ./data.ts.
import type { ComponentType } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';

export interface ViewProps {
  block: BlockRecord;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  readOnly: boolean;
}

export const viewRegistry: Partial<Record<string, ComponentType<ViewProps>>> = {};

export function registerView(type: string, comp: ComponentType<ViewProps>) {
  viewRegistry[type] = comp;
}

/** Layout-specific rows of the view settings "Layout" page (Show calendar by, Show timeline by, Map by, …),
 *  rendered between "Show page icon" and "Open pages in". Registered by the view modules. */
export interface LayoutSettingsProps {
  view: CollectionViewRecord;
  collection: CollectionRecord;
  readOnly: boolean;
}

export const layoutSettingsRegistry: Partial<Record<string, ComponentType<LayoutSettingsProps>>> = {};

export function registerLayoutSettings(type: string, comp: ComponentType<LayoutSettingsProps>) {
  layoutSettingsRegistry[type] = comp;
}

/** Replacement for the generic rows of the view settings main page (charts show Chart type / X axis / Y axis /
 *  Style instead of Property visibility / Filter / Sort / Group). `go` opens a core sub-page ('layout', 'filter', …). */
export interface ViewSettingsMainProps {
  block: BlockRecord;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  readOnly: boolean;
  go: (page: string) => void;
  close: () => void;
}

export const viewSettingsMainRegistry: Partial<Record<string, ComponentType<ViewSettingsMainProps>>> = {};

export function registerViewSettingsMain(type: string, comp: ComponentType<ViewSettingsMainProps>) {
  viewSettingsMainRegistry[type] = comp;
}

/** Toolbar buttons that replace "New" for a view type (form builder: "Preview" + "Share form"). */
export interface ToolbarExtraProps {
  block: BlockRecord;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  readOnly: boolean;
}

export const toolbarExtrasRegistry: Partial<Record<string, ComponentType<ToolbarExtraProps>>> = {};

export function registerToolbarExtra(type: string, comp: ComponentType<ToolbarExtraProps>) {
  toolbarExtrasRegistry[type] = comp;
}

/** Buttons a view type adds at the left end of the toolbar, before Filter (calendar / timeline "No date (N)"). */
export interface ToolbarLeadingProps {
  block: BlockRecord;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  readOnly: boolean;
}

export const toolbarLeadingRegistry: Partial<Record<string, ComponentType<ToolbarLeadingProps>>> = {};

export function registerToolbarLeading(type: string, comp: ComponentType<ToolbarLeadingProps>) {
  toolbarLeadingRegistry[type] = comp;
}

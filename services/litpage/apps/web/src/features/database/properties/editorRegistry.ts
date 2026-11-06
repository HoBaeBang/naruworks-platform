// Pluggable cell editors / property config panels so other database work streams (relation, rollup,
// formula, button actions) can provide their own UI while reusing PropertyCell and the property menus.
import type { ComponentType } from 'react';
import type { CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';

export interface CellEditorOptions {
  rowIds: string[];
  propId: string;
  collectionId: string;
  view?: CollectionViewRecord;
  onClose?: () => void;
}

/** Opens an editor anchored to a cell; returns a close function. */
export type CellEditorOpener = (anchor: HTMLElement, opts: CellEditorOptions) => () => void;

export const cellEditorRegistry: Partial<Record<string, CellEditorOpener>> = {};

export function registerCellEditor(type: string, opener: CellEditorOpener) {
  cellEditorRegistry[type] = opener;
}

export interface PropertyConfigProps {
  collection: CollectionRecord;
  propId: string;
  prop: PropertySchema;
  view?: CollectionViewRecord;
  close: () => void;
}

/** Type-specific section of the "Edit property" panel (formula editor, relation/rollup config…). */
export const propertyConfigRegistry: Partial<Record<string, ComponentType<PropertyConfigProps>>> = {};

export function registerPropertyConfig(type: string, comp: ComponentType<PropertyConfigProps>) {
  propertyConfigRegistry[type] = comp;
}

/** Called right after "+ Add property" creates a property of `type` (e.g. Relation opens its "Related to" panel). */
export type PropertyCreatedHook = (opts: { anchor: HTMLElement | DOMRect | null; collectionId: string; propId: string; viewId?: string }) => void;

export const propertyCreatedHooks: Partial<Record<string, PropertyCreatedHook>> = {};

export function registerPropertyCreated(type: string, hook: PropertyCreatedHook) {
  propertyCreatedHooks[type] = hook;
}

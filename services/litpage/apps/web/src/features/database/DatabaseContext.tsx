// Per-database-block UI context shared by the chrome (tabs/toolbar/selection bar) and every view renderer.
import { createContext, useContext } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import type { GroupResult } from '@nc/shared/database/index.ts';

export type PeekMode = 'side_peek' | 'center_peek' | 'full_page';

export interface DatabaseContextValue {
  block: BlockRecord;
  collection: CollectionRecord;
  view: CollectionViewRecord;
  
  readOnly: boolean;
  
  structureReadOnly: boolean;
  
  schemaReadOnly?: boolean;
  
  locked: boolean;
  
  canAddRows: boolean;
  inline: boolean;
  
  search: string;
  
  selection: string[];
  setSelection: (ids: string[] | ((prev: string[]) => string[])) => void;
  
  peekMode: PeekMode;
  openRow: (rowId: string, mode?: PeekMode) => void;
  
  addRow: (opts?: { after?: string; before?: string; group?: GroupResult | null; subgroup?: GroupResult | null; position?: 'end' | 'start'; open?: boolean; editTitle?: boolean }) => string;
  
  addFilter: (propId: string) => void;
  
  bleed: { left: number; right: number; width: number | null };
  
  editingTitle: string | null;
  setEditingTitle: (id: string | null) => void;
}

export const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function useDatabaseContext(): DatabaseContextValue | null {
  return useContext(DatabaseContext);
}

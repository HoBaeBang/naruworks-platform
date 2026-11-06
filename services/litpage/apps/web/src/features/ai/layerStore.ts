
import { create } from 'zustand';
import type { SkillId } from './skills.ts';

export interface WriterTarget {
  pageId: string;
  
  blockId: string;
  
  mode: 'empty' | 'below' | 'selection' | 'blocks';
  start?: number;
  end?: number;
  blockIds?: string[];
  
  selectionMd?: string;
  
  property?: string;
  
  skill?: SkillId | null;
  
  skillId?: string;
  
  prompt?: string;
  
  language?: string;
  
  seq: number;
}


export type ChatPanelMode = 'sidebar' | 'floating';

interface AiLayerState {
  panelOpen: boolean;
  panelThreadId: string | null;
  panelQuery: { text: string; retrieve?: boolean; key: string } | null;
  
  panelMode: ChatPanelMode;
  
  panelWidth: number | null;
  writer: WriterTarget | null;
  openPanel: (opts?: { threadId?: string | null; query?: string; retrieve?: boolean }) => void;
  closePanel: () => void;
  setPanelThread: (id: string | null) => void;
  setPanelMode: (m: ChatPanelMode) => void;
  setPanelWidth: (w: number | null) => void;
  openWriter: (t: Omit<WriterTarget, 'seq'>) => void;
  closeWriter: () => void;
}

let seq = 1;

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    
  }
}

export const useAiLayer = create<AiLayerState>((set) => ({
  panelOpen: false,
  panelThreadId: null,
  panelQuery: null,
  panelMode: readLS('nc:ai:panelMode') === 'floating' ? 'floating' : 'sidebar',
  panelWidth: Number(readLS('nc:ai:panelWidth')) || null,
  writer: null,
  openPanel: (opts) => set((s) => ({
    panelOpen: true,
    writer: null,
    panelThreadId: opts?.threadId !== undefined ? opts.threadId : opts?.query ? null : s.panelThreadId,
    panelQuery: opts?.query ? { text: opts.query, retrieve: opts.retrieve, key: `q${seq++}` } : null,
  })),
  closePanel: () => set({ panelOpen: false, panelQuery: null }),
  setPanelThread: (id) => set({ panelThreadId: id }),
  setPanelMode: (m) => {
    writeLS('nc:ai:panelMode', m);
    set({ panelMode: m });
  },
  setPanelWidth: (w) => {
    writeLS('nc:ai:panelWidth', w === null ? null : String(Math.round(w)));
    set({ panelWidth: w === null ? null : Math.round(w) });
  },
  openWriter: (t) => set({ writer: { ...t, seq: seq++ } }),
  closeWriter: () => set({ writer: null }),
}));

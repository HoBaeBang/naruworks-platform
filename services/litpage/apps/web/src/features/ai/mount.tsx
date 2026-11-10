
// listeners) in its own React root, so the AI feature plugs in without editing the shell. Loaded
// through AiBlock.block.tsx (auto-imported at startup by editor/blocks/registerAll.ts).
import { createRoot } from 'react-dom/client';
import { AiLayer } from './AiLayer.tsx';
import './ai.css';

const KEY = '__ncAiLayerRoot';

function mount() {
  const w = window as any;
  if (w[KEY]) return;
  const el = document.createElement('div');
  el.id = 'nc-ai-layer';
  document.body.appendChild(el);
  w[KEY] = createRoot(el);
  w[KEY].render(<AiLayer />);
}

if (typeof document !== 'undefined') {
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}

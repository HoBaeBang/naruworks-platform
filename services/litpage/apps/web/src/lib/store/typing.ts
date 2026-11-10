

import { useUI } from './ui.ts';

let installed = false;
export function markTyping() {
  if (!useUI.getState().typing) useUI.getState().set({ typing: true });
}

export function installTypingFade() {
  if (installed) return;
  installed = true;
  let lastX = -1;
  let lastY = -1;
  window.addEventListener('mousemove', (e) => {
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) < 3) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (useUI.getState().typing) useUI.getState().set({ typing: false });
  }, { passive: true });
}

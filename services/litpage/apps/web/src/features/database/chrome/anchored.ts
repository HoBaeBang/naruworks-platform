// renders a toolbar's popovers as React portals of the hovered container, so hover-only controls of that
// container (the actions "Minimize" chevron, the title's "+ •••") stay visible while the popover is open even though
// the pointer has moved onto it. Our overlays a separate stack, so we ask the stack instead.
import type { RefObject } from 'react';
import { useOverlays } from '../../../components/overlay.tsx';

/** True while an overlay anchored to an element inside `ref` (matching `selector`, when given) is open. */
export function useAnchoredOverlayOpen(ref: RefObject<HTMLElement | null>, selector?: string): boolean {
  return useOverlays((s) => s.stack.some((e) => {
    const a = e.opts.anchor;
    if (!(a instanceof HTMLElement) || !ref.current?.contains(a)) return false;
    return !selector || !!a.closest(selector);
  }));
}

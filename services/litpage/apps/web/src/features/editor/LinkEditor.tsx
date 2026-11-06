// ⌘K / toolbar link popover — implementation lives in inline/LinkPopups.tsx; this module keeps the older entry point.
import { openLinkPopup } from './inline/LinkPopups.tsx';

export function openLinkEditor(blockId: string, property: string, start: number, end: number, _rect?: DOMRect) {
  openLinkPopup({ blockId, property, start, end });
}

export { openLinkPopup, openLinkEdit, LinkHoverPill, followLink } from './inline/LinkPopups.tsx';

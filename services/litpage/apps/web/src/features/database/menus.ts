// Menus opened from inside another popover (an option list of a settings row, the operator of a filter
// editor, a date-format submenu…): choosing an option closes only that menu and keeps the parent open,
//. (components/Menu closes every overlay unless onSelect returns false.)
import { openMenu, type MenuDef } from '../../components/Menu.tsx';

export function openNestedMenu(anchor: Parameters<typeof openMenu>[0], def: MenuDef, opts?: Parameters<typeof openMenu>[2]): () => void {
  let close: () => void = () => {};
  const sections = def.sections.map((s) => ({
    ...s,
    items: s.items.map((it) => (it.onSelect && !it.submenu ? {
      ...it,
      onSelect: () => {
        const r = it.onSelect!();
        if (r !== false) close();
        return false;
      },
    } : it)),
  }));
  close = openMenu(anchor, { ...def, sections }, opts);
  return close;
}

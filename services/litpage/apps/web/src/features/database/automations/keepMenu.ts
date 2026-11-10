// Menus opened inside the automation builder / button config: choosing an item closes only this menu (and its
// submenus), never the builder behind it (components/Menu closes every overlay unless onSelect returns false).
import { openMenu, type MenuDef } from '../../../components/Menu.tsx';

export function openKeepMenu(anchor: Parameters<typeof openMenu>[0], def: MenuDef, opts?: Parameters<typeof openMenu>[2]): () => void {
  let close: () => void = () => {};
  const wrap = (d: MenuDef): MenuDef => ({
    ...d,
    sections: d.sections.map((s) => ({
      ...s,
      items: s.items.map((it) => {
        if (it.submenu) {
          const sub = it.submenu;
          return { ...it, submenu: () => wrap(sub()) };
        }
        if (!it.onSelect) return it;
        const fn = it.onSelect;
        return { ...it, onSelect: () => { const r = fn(); if (r !== false) close(); return false; } };
      }),
    })),
  });
  close = openMenu(anchor, wrap(def), opts);
  return close;
}

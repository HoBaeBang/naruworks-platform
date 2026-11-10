
// optional "Search actions…" filter, keyboard navigation and hover-opened submenus.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { openOverlay, PopoverSurface, useOverlays, type Anchor, type Placement } from './overlay.tsx';
import './menu.css';

export interface MenuItemDef {
  id?: string;
  label: ReactNode;
  
  text?: string;
  icon?: string | ReactNode;
  iconColor?: string;
  right?: ReactNode;
  shortcut?: string;
  badge?: string;
  description?: ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  keywords?: string[];
  submenu?: () => MenuDef;
  
  onSelect?: () => unknown;
  render?: () => ReactNode; // custom row content
}

export interface MenuSectionDef {
  title?: ReactNode;
  items: MenuItemDef[];
}

export interface MenuDef {
  sections: MenuSectionDef[];
  search?: boolean | string;
  width?: number;
  footer?: ReactNode;
  header?: ReactNode;
  emptyText?: string;
  maxHeight?: string | number;
  
  dividers?: boolean;
  
  initialActive?: number;
  
  className?: string;
  
  role?: 'listbox' | 'menu';
  
  searchIcon?: boolean;
  
  hoverAfterMove?: boolean;
  
  renderLimit?: number;
  
  searchSections?: () => MenuSectionDef[];
}

function itemText(it: MenuItemDef): string {
  return (it.text ?? (typeof it.label === 'string' ? it.label : '')).toLowerCase();
}

export function filterSections(sections: MenuSectionDef[], query: string): MenuSectionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => itemText(it).includes(q) || (it.keywords ?? []).some((k) => k.toLowerCase().includes(q))),
    }))
    .filter((s) => s.items.length);
}

export function MenuIcon({ icon, color }: { icon?: string | ReactNode; color?: string }) {
  if (!icon) return null;
  return (
    <div className="nc-menu-icon" style={{ color: color ?? 'var(--lp-icon-primary)' }}>
      {typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}
    </div>
  );
}

export function MenuRow({ item, active, onHover, onLeave, onClick, role = 'option' }: { item: MenuItemDef; active: boolean; onHover?: () => void; onLeave?: () => void; onClick?: (e: React.MouseEvent) => void; role?: 'option' | 'menuitem' }) {
  return (
    <div
      role={role}
      aria-selected={role === 'option' ? active : undefined}
      aria-disabled={item.disabled || undefined}
      className={`nc-menu-item ${active ? 'active' : ''} ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
      onMouseMove={onHover}
      onMouseLeave={onLeave}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {item.render ? (
        item.render()
      ) : (
        
        <div className={`nc-menu-item-inner nc-mi${item.description ? ' has-desc' : ''}`}>
          <MenuIcon icon={item.icon} color={item.danger ? 'var(--lp-red-icon-primary, #c4554d)' : item.iconColor} />
          <div className="nc-menu-label">
            {item.badge ? (
              
              <div className="nc-menu-label-row">
                <div className="nc-ellipsis">{item.label}</div>
                <span className={`nc-menu-badge${item.badge === 'New' ? ' blue' : ''}`}>{item.badge}</span>
              </div>
            ) : (
              <div className="nc-ellipsis">{item.label}</div>
            )}
            {item.description && <div className="nc-menu-desc">{item.description}</div>}
          </div>
          {item.right}
          {item.shortcut && <span className="nc-menu-shortcut">{item.shortcut}</span>}
          {item.checked && <Icon name="check" size={16} style={{ color: 'var(--lp-icon-primary)' }} />}
          {item.submenu && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />}
        </div>
      )}
    </div>
  );
}


export function MenuSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="nc-menu-section-title">
      <div className="nc-menu-section-title-text">{children}</div>
      <div className="nc-menu-section-title-slot"><div><span className="nc-menu-section-title-spin" /></div></div>
    </div>
  );
}

export function Menu({ def, close, overlayId, externalQuery, keyTarget, focusList }: { def: MenuDef; close: () => void; overlayId?: number; externalQuery?: string; keyTarget?: 'window'; focusList?: boolean }) {
  const [query, setQuery] = useState('');
  const q = externalQuery ?? query;
  const sections = useMemo(() => {
    const base = filterSections(def.sections, q);
    if (!q.trim() || !def.searchSections) return base;
    return [...base, ...filterSections(def.searchSections(), q)];
  }, [def, q]);
  const flat = useMemo(() => sections.flatMap((s) => s.items.filter((i) => !i.disabled)), [sections]);
  const [active, setActive] = useState(def.initialActive ?? 0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const subClose = useRef<(() => void) | null>(null);
  const rowRefs = useRef(new Map<MenuItemDef, HTMLDivElement>());
  const pointerSeen = useRef(!def.hoverAfterMove);
  const itemRole = def.role === 'menu' ? 'menuitem' : 'option';
  const [fade, setFade] = useState(false);
  // the limit restarts whenever the rows change (new filter query)
  const [lim, setLim] = useState<{ rows: MenuSectionDef[]; n: number } | null>(null);
  const limit = lim && lim.rows === sections ? lim.n : (def.renderLimit ?? Infinity);
  const setLimit = (n: number) => setLim({ rows: sections, n });
  const limitRef = useRef(limit);
  limitRef.current = limit;
  // keyboard-reachable rows that are rendered (the active index counts enabled rows only)
  const renderedEnabled = useMemo(() => {
    if (limit === Infinity) return Infinity;
    return sections.flatMap((s) => s.items).slice(0, limit).filter((i) => !i.disabled).length;
  }, [sections, limit]);
  useEffect(() => {
    if (active >= renderedEnabled) setLimit(Infinity);
  }, [active, renderedEnabled]);

  
  useEffect(() => {
    if (focusList) listRef.current?.focus({ preventScroll: true });
  }, [focusList]);

  
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const upd = () => {
      const rest = el.scrollHeight - el.scrollTop - el.clientHeight;
      setFade(rest > 1);
      // lazily rendered list (renderLimit): the remaining rows appear once the end is less than a page away
      if (limitRef.current !== Infinity && rest < el.clientHeight) setLimit(Infinity);
    };
    upd();
    el.addEventListener('scroll', upd);
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', upd);
      ro.disconnect();
    };
  }, [sections]);

  useEffect(() => setActive(q ? 0 : (def.initialActive ?? 0)), [q, def.initialActive]);

  const select = (it: MenuItemDef) => {
    if (it.disabled) return;
    if (it.submenu) {
      openSub(it);
      return;
    }
    const keep = it.onSelect?.() === false;
    if (!keep) {
      useOverlays.getState().closeAll();
      close();
    }
  };

  const subFor = useRef<MenuItemDef | null>(null);
  
  
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } };
  const openSubSoon = (it: MenuItemDef) => {
    cancelHover();
    hoverTimer.current = setTimeout(() => { hoverTimer.current = null; openSub(it); }, 120);
  };
  useEffect(() => cancelHover, []);
  const openSub = (it: MenuItemDef) => {
    cancelHover();
    subClose.current?.();
    const el = rowRefs.current.get(it);
    if (!el || !it.submenu) return;
    const stack = useOverlays.getState().stack;
    const parent = overlayId ?? stack[stack.length - 1]?.id;
    subFor.current = it;
    
    
    const closeSub = openMenu(el, it.submenu(), {
      placement: 'right', offset: 0, backdrop: 'none', parent, focusList: true,
      onClose: () => {
        if (subFor.current === it) subFor.current = null;
        // focus back to the parent's search field while the parent stays open (not on closeAll)
        if (parent && useOverlays.getState().stack.some((e) => e.id === parent)) searchRef.current?.focus({ preventScroll: true });
      },
    });
    subClose.current = closeSub;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = useOverlays.getState().stack;
      const mine = overlayId ?? top[top.length - 1]?.id;
      if (top.length && top[top.length - 1].id !== mine && !keyTarget) return;
      // inputs embedded in menus (rename fields, prefix inputs…) keep their own keys
      if ((e.target as HTMLElement | null)?.closest?.('[data-menu-keys="ignore"]')) return;
      if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
        e.preventDefault();
        setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
      } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
        e.preventDefault();
        setActive((a) => (flat.length ? (a <= 0 ? flat.length - 1 : a - 1) : 0));
      } else if (e.key === 'Enter' && !e.isComposing) {
        const it = flat[active];
        if (it) {
          e.preventDefault();
          e.stopPropagation();
          select(it);
        }
      } else if (e.key === 'ArrowRight') {
        const it = flat[active];
        if (it?.submenu) {
          e.preventDefault();
          openSub(it);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    const it = flat[active];
    const el = it && rowRefs.current.get(it);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, flat, limit]);

  let idx = -1;
  let shown = 0;
  return (
    <PopoverSurface width={def.width ?? 265} maxHeight={def.maxHeight} className={def.className}>
      {def.header}
      {def.search && externalQuery === undefined && (
        
        <div className="nc-menu-search">
          <div className="nc-input">
            {def.searchIcon && <Icon name="search" size={16} style={{ color: 'var(--lp-icon-secondary)', marginInlineEnd: 6, flexShrink: 0 }} />}
            <input
              ref={searchRef}
              autoFocus
              placeholder={typeof def.search === 'string' ? def.search : 'Search…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              role="combobox"
            />
          </div>
        </div>
      )}
      <div className={`lit-scroller vertical nc-menu-scroll${fade ? ' nc-menu-fade' : ''}`} ref={listRef} tabIndex={focusList ? 0 : undefined}>
        <div className="nc-menu-list" role={def.role ?? 'listbox'}>
        {sections.length === 0 && <div className="nc-menu-empty">{def.emptyText ?? 'No results'}</div>}
        {sections.map((s, si) => {
          if (shown >= limit) return null;
          const rows = limit === Infinity ? s.items : s.items.slice(0, limit - shown);
          shown += rows.length;
          return (
          <div className={`nc-menu-section${s.title ? ' titled' : ''}${def.dividers === false ? ' no-divider' : ''}`} key={si}>
            {s.title && <MenuSectionTitle>{s.title}</MenuSectionTitle>}
            {rows.map((it, ii) => {
              if (!it.disabled) idx++;
              const myIdx = it.disabled ? -1 : idx;
              return (
                <div key={it.id ?? ii} ref={(el) => { if (el) rowRefs.current.set(it, el); }}>
                  <MenuRow
                    item={it}
                    role={itemRole}
                    active={myIdx === active}
                    onHover={() => {
                      if (myIdx < 0) return;
                      if (!pointerSeen.current) { pointerSeen.current = true; return; }
                      if (myIdx !== active) {
                        setActive(myIdx);
                        if (it.submenu) openSubSoon(it);
                        else {
                          cancelHover();
                          if (subClose.current) { subClose.current(); subClose.current = null; subFor.current = null; }
                        }
                      } else if (it.submenu && subFor.current !== it && !hoverTimer.current) {
                        // already-active item (e.g. the default first row): hovering still opens its submenu
                        openSubSoon(it);
                      }
                    }}
                    onLeave={cancelHover}
                    onClick={() => select(it)}
                  />
                </div>
              );
            })}
          </div>
          );
        })}
        </div>
      </div>
      {def.footer}
    </PopoverSurface>
  );
}

export function openMenu(anchor: Anchor, def: MenuDef, opts?: { placement?: Placement; offset?: number; onClose?: () => void; backdrop?: 'transparent' | 'none' | 'dim'; parent?: number; focusList?: boolean }) {
  let overlayId = 0;
  const close = openOverlay((c) => <Menu def={def} close={c} overlayId={overlayId} focusList={opts?.focusList} />, {
    anchor, placement: opts?.placement ?? 'bottom-start', offset: opts?.offset ?? 4, onClose: opts?.onClose, backdrop: opts?.backdrop ?? 'transparent', parent: opts?.parent,
  });
  const st = useOverlays.getState().stack;
  overlayId = st[st.length - 1]?.id ?? 0;
  return close;
}

export function MenuDivider() {
  return <div className="nc-menu-divider" />;
}

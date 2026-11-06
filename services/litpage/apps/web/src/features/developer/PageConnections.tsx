// Page ••• › Connections: connections that can reach this page — shared here (hover → Disconnect) or
// inherited ("<parent page>") — "Search for connections…" to add one of the workspace's connections (Full access
// to the page needed; the server checks), and "Manage connections" (Settings › Connections).
import { create } from 'zustand';
import type { ReactNode } from 'react';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import type { MenuDef, MenuItemDef } from '../../components/Menu.tsx';
import { t } from '../shell/i18n.ts';
import type { Capabilities } from './api.ts';

interface PageConn {
  integrationId: string;
  name: string;
  icon: string | null;
  direct: boolean;
  sourceId?: string;
  sourceTitle?: string;
  capabilities: Capabilities;
}

interface Entry {
  connections: PageConn[];
  addable: { id: string; name: string; icon: string | null }[];
  canManage: boolean;
  loaded: boolean;
}

const EMPTY: Entry = { connections: [], addable: [], canManage: false, loaded: false };

const useStore = create<{ pages: Record<string, Entry>; set(pageId: string, e: Entry): void }>((set) => ({
  pages: {},
  set: (pageId, e) => set((s) => ({ pages: { ...s.pages, [pageId]: e } })),
}));

export function loadPageConnections(pageId: string): Promise<void> {
  return api<Omit<Entry, 'loaded'> & { recordMap: any }>('devPageConnections', { pageId })
    .then((r) => {
      records.mergeRecordMap(r.recordMap);
      useStore.getState().set(pageId, { connections: r.connections, addable: r.addable, canManage: r.canManage, loaded: true });
    })
    .catch(() => useStore.getState().set(pageId, { ...EMPTY, loaded: true }));
}

function logo(icon: string | null): ReactNode {
  if (icon && /^(https?:|\/files\/)/.test(icon)) return <img src={icon} alt="" style={{ width: 18, height: 18, borderRadius: 4 }} />;
  if (icon) return <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{icon}</span>;
  return 'curlyBraces';
}

function RightLabel({ pageId }: { pageId: string }) {
  const e = useStore((s) => s.pages[pageId]) ?? EMPTY;
  return <span className="nc-menu-right-label">{!e.loaded ? '' : e.connections.length ? String(e.connections.length) : t('lp.developer.none', 'None')}</span>;
}

async function add(pageId: string, connectionId: string, name: string) {
  try {
    await api('devAddPageConnection', { pageId, connectionId });
    await loadPageConnections(pageId);
    useUI.getState().toast(t('lp.developer.added_to_this_page', 'Added {name} to this page', { name }));
  } catch (e) {
    useUI.getState().toast((e as Error).message);
  }
}

async function remove(pageId: string, connectionId: string, name: string) {
  try {
    await api('devRemovePageConnection', { pageId, connectionId });
    await loadPageConnections(pageId);
    useUI.getState().toast(t('lp.developer.disconnected_from_this_page', 'Disconnected {name} from this page', { name }));
  } catch (e) {
    useUI.getState().toast((e as Error).message);
  }
}

/** The "Connections" row of the page ••• menu (opens its submenu cached list; refreshed on open). */
export function connectionsMenuItem(pageId: string, item: (label: string, icon: string, extra?: Partial<MenuItemDef>) => MenuItemDef): MenuItemDef {
  void loadPageConnections(pageId);
  return item(t('lp.developer.connections', 'Connections'), 'connections', {
    right: <RightLabel pageId={pageId} />,
    keywords: ['connections', 'integrations', 'api', 'bot'],
    submenu: (): MenuDef => {
      const e = useStore.getState().pages[pageId] ?? EMPTY;
      const connected: MenuItemDef[] = e.connections.map((c) => ({
        label: c.name,
        text: c.name,
        icon: logo(c.icon),
        description: c.direct ? undefined : `${t('lp.developer.from', 'From')} ${c.sourceTitle ?? ''}`,
        right: c.direct && e.canManage ? (
          <span
            role="button"
            className="nc-menu-right-label"
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
            onClick={(ev) => { ev.stopPropagation(); void remove(pageId, c.integrationId, c.name); }}
          >
            {t('lp.developer.disconnect', 'Disconnect')}
          </span>
        ) : undefined,
        onSelect: () => { if (c.direct && e.canManage) void remove(pageId, c.integrationId, c.name); },
      }));
      return {
        width: 300,
        role: 'menu',
        className: 'nc-page-submenu',
        sections: [
          ...(connected.length ? [{ items: connected }] : []),
          {
            items: [
              {
                label: t('lp.developer.search_connections', 'Search connections…'),
                icon: 'plus',
                disabled: !e.canManage,
                description: e.canManage ? undefined : t('lp.developer.you_need_full_access_to_this', 'You need full access to this page to add connections.'),
                submenu: (): MenuDef => ({
                  width: 280,
                  search: t('lp.developer.search_connections', 'Search connections…'),
                  emptyText: t('lp.developer.no_results', 'No results'),
                  sections: [{
                    items: e.addable.map((a) => ({
                      label: t('lp.developer.text_18f6', '{name}', { name: a.name }), text: a.name, icon: logo(a.icon),
                      onSelect: () => void add(pageId, a.id, a.name),
                    })),
                  }],
                }),
              },
              { label: t('lp.developer.manage_connections', 'Manage connections'), icon: 'settings', onSelect: () => useUI.getState().openSettings('connections') },
            ],
          },
        ],
      };
    },
  });
}


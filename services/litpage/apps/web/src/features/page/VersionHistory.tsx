// Version history: preview of a selected version on the left,
// versions list on the right (getVersionHistory), "Begin restore" → restore panel → restoreVersion.
// Bookmarks are named ("Name this version" / "Rename this version"); "Copy link to version" shares a URL
// that reopens this version (`?vh=<id>`); copying a selection in the preview puts the version's blocks on
// the clipboard so they paste into the page as blocks (partial restore).
// Snapshots are taken by the server (history.ts: every 10 min while editing; pages.ts: 2 min after the
// last edit; before/after each restore).
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { compactId, expandId } from '@nc/shared/ids.ts';
import type { BlockRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { getBlock } from '../../lib/blocks.ts';
import { useUI } from '../../lib/store/ui.ts';
import { userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { SnapshotPage } from './SnapshotPage.tsx';
import { BLOCKS_MIME, blocksToHtml, blocksToMarkdown, type ParsedBlock } from '../editor/clipboard.ts';
import { pageUrl } from '../../lib/router.ts';
import { loadPage } from './usePageLoader.ts';
import { confirmDialog } from './confirm.tsx';
import './pageIcons.tsx';
import './history.css';

interface Version { id: string; createdTime: number; authorIds: string[]; current: boolean }

export function versionTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return t('lp.page.today_at', 'Today at {time}', { time });
  if (diff === 1) return t('lp.page.yesterday_at', 'Yesterday at {time}', { time });
  if (diff < 7) return t('lp.page.at', '{weekday} at {time}', { weekday: d.toLocaleDateString('en-US', { weekday: 'long' }), time });
  return t('lp.page.at_8709', '{date} at {time}', { date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }), time });
}

const GROUPS: { id: string; label: string; short: string; ms: number }[] = [
  { id: '1s', label: t('lp.page.1_second', '1 second'), short: '1s', ms: 0 },
  { id: '1m', label: t('lp.page.1_minute', '1 minute'), short: '1m', ms: 60_000 },
  { id: '15m', label: t('lp.page.15_minutes', '15 minutes'), short: '15m', ms: 15 * 60_000 },
  { id: '1h', label: t('lp.page.1_hour', '1 hour'), short: '1h', ms: 3600_000 },
  { id: '4h', label: t('lp.page.4_hours', '4 hours'), short: '4h', ms: 4 * 3600_000 },
  { id: 'bookmarks', label: t('lp.page.bookmarks', 'Bookmarks'), short: t('lp.page.bookmarks', 'Bookmarks'), ms: 0 },
];


const NO_CHANGES = new Set<string>();


export function openVersionHistory(pageId: string, opts?: { snapshotId?: string | null }) {
  openOverlay((close) => <VersionHistory pageId={pageId} close={close} initial={opts?.snapshotId ?? null} />, { placement: 'center', backdrop: 'none', className: 'nc-vh-overlay' });
}

function VersionHistory({ pageId, close, initial }: { pageId: string; close: () => void; initial?: string | null }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [preview, setPreview] = useState<{ id: string; blocks: BlockRecord[]; databases: VersionDatabase[] } | null>(null);
  // "Also restore databases on this page"
  const [withDatabases, setWithDatabases] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grouping, setGrouping] = useState<string>('1m');
  const [bookmarks, setBookmarks] = useState<Record<string, string>>({});
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const page = getBlock(pageId);

  const load = useCallback(async () => {
    try {
      const res = await api('getVersionHistory', { pageId });
      records.mergeRecordMap(res.recordMap);
      setVersions(res.versions);
      setBookmarks(res.bookmarks ?? {});
      setSelected((s) => s ?? res.versions[0]?.id ?? null);
    } catch (e: any) {
      setError(e?.status === 403 ? 'You need edit access to view version history.' : t('lp.page.couldn_t_load_version_history', 'Couldn’t load version history.'));
    }
  }, [pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setPreview(null);
    void api('getVersionPreview', { snapshotId: selected }).then((res) => {
      if (!alive) return;
      records.mergeRecordMap(res.recordMap);
      setPreview({ id: res.id, blocks: res.blocks, databases: res.databases ?? [] });
      setChangedIds(new Set(res.changedBlockIds ?? []));
    }).catch(() => alive && setError(t('lp.page.this_version_couldn_t_be_loaded', 'This version couldn’t be loaded.')));
    return () => { alive = false; };
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!versions?.length || restoring) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = versions.findIndex((v) => v.id === selected);
      const j = Math.max(0, Math.min(versions.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelected(versions[j].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [versions, selected, restoring]);

  const current = versions?.find((v) => v.id === selected);
  // Change outlines only for an older version that differs from its predecessor: the current (newest) version
  // previews the page as it is; the first version has nothing to compare with.
  const isNewest = !!versions?.length && (versions[0].id === selected || !!current?.current);
  const shownChanged = isNewest || !versions ? NO_CHANGES : changedIds;

  const saveBookmark = async (v: Version, name: string | null) => {
    try {
      await api('bookmarkVersion', { snapshotId: v.id, name });
      setBookmarks((b) => {
        const next = { ...b };
        if (name) next[v.id] = name;
        else delete next[v.id];
        return next;
      });
    } catch {
      /* ignore */
    }
  };
  // not bookmarked: "Name this version"; bookmarked: Rename this version / Delete bookmark (confirm)
  const toggleBookmark = (v: Version, anchor: HTMLElement) => {
    if (!bookmarks[v.id]) {
      openNameDialog(versionTimestamp(v.createdTime), false, versionTimestamp(v.createdTime), (name) => void saveBookmark(v, name));
      return;
    }
    const closeMenu = openMenu(anchor, {
      width: 220,
      sections: [{ items: [
        { label: t('lp.page.rename_page_version', 'Rename page version'), icon: 'edit', onSelect: () => { closeMenu(); openNameDialog(versionTimestamp(v.createdTime), true, bookmarks[v.id], (name) => void saveBookmark(v, name)); return false; } },
        { label: t('lp.page.delete', 'Delete'), icon: 'trash', onSelect: () => {
          closeMenu();
          void confirmDialog({
            message: t('lp.page.remove_this_bookmark', 'Remove this bookmark?'),
            description: t('lp.page.only_your_bookmark_goes_away_the', 'Only your bookmark goes away. The version itself remains in page history.'),
            confirmLabel: t('lp.page.delete', 'Delete'),
          }).then((ok) => { if (ok) void saveBookmark(v, null); });
          return false;
        } },
      ] }],
    }, { placement: 'bottom-end' });
  };

  // partial restore: copying in the preview carries the version's blocks (pasted into the page as real blocks)
  const previewRef = useRef<HTMLDivElement>(null);
  const onPreviewCopy = (e: React.ClipboardEvent) => {
    if (!preview || !e.clipboardData) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !previewRef.current) return;
    const map = new Map(preview.blocks.map((b) => [b.id, b]));
    const els = [...previewRef.current.querySelectorAll<HTMLElement>('[data-snapshot-block-id]')].filter((el) => sel.containsNode(el, true));
    // top-most selected blocks only (children travel inside their parent)
    const ids = els.map((el) => el.dataset.snapshotBlockId!).filter((id, _i, all) => {
      let cur = map.get(id);
      for (let k = 0; k < 40 && cur; k++) {
        cur = map.get(cur.parent_id);
        if (cur && all.includes(cur.id)) return false;
      }
      return id !== pageId;
    });
    if (ids.length < 2 && els.length < 2) return; // a selection inside one block copies as plain text
    const toParsed = (id: string): ParsedBlock | null => {
      const b = map.get(id);
      if (!b || b.alive === false) return null;
      const { title, ...props } = (b.properties ?? {}) as Record<string, any>;
      return { type: b.type, title: title ?? [], props: Object.keys(props).length ? props : undefined, format: b.format, children: b.type === 'page' ? [] : (b.content ?? []).map(toParsed).filter((x): x is ParsedBlock => !!x) };
    };
    const blocks = ids.map(toParsed).filter((x): x is ParsedBlock => !!x && x.type !== 'page' && x.type !== 'collection_view_page');
    if (!blocks.length) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', blocksToMarkdown(blocks));
    e.clipboardData.setData('text/html', blocksToHtml(blocks));
    e.clipboardData.setData(BLOCKS_MIME, JSON.stringify({ v: 1, blocks }));
    useUI.getState().toast(t('lp.page.copied_from_this_version_paste_it', 'Copied from this version — paste it into the page'));
  };

  const copyVersionLink = (id = selected) => {
    if (!id) return;
    void navigator.clipboard?.writeText(`${location.origin}${pageUrl(pageId)}?vh=${compactId(id)}`);
    useUI.getState().toast(t('lp.page.copied_link_to_version', 'Copied link to version'));
  };
  // ⌘⌥L (Copy link) while the history is open copies the selected version's link
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyL') {
        e.preventDefault();
        e.stopPropagation();
        copyVersionLink();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api('restoreVersion', { snapshotId: selected, restoreDatabases: withDatabases });
      records.mergeRecordMap(res.recordMap);
      await loadPage(pageId, true);
      useUI.getState().toast(res.databasesUnchanged
        ? t('lp.page.restored_an_earlier_version_but_count', 'Restored an earlier version, but {count, plural, one {# database was left unchanged} other {# databases were left unchanged}}.', { count: res.databasesUnchanged })
        : t('lp.page.previous_version_restored_successfully', 'Previous version restored successfully.'));
      close();
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.page.couldn_t_restore_the_version', 'Couldn’t restore the version.'));
      setBusy(false);
    }
  };

  const title = toPlainText(page?.properties?.title) || t('lp.page.untitled', 'Untitled');
  // a full-page database version is its data: full access needed
  const ownDb = preview?.databases.find((d) => d.blockId === pageId && !d.inline);
  const dbBlocked = !!ownDb && ownDb.status === 'unchanged' && !!ownDb.reason;
  const restoreDisabled = !current || current.current || dbBlocked;
  const bucket = GROUPS.find((g) => g.id === grouping) ?? GROUPS[1];
  const listed = (versions ?? []).filter((v, i, arr) => {
    if (grouping === 'bookmarks') return !!bookmarks[v.id];
    if (!bucket.ms) return true;
    const prev = arr[i - 1];
    return !prev || Math.floor(prev.createdTime / bucket.ms) !== Math.floor(v.createdTime / bucket.ms);
  });
  return (
    <div className="nc-vh lit-dialog" role="dialog" aria-label={t('lp.page.version_history', 'Version history')}>
      <aside className="nc-vh-sidebar">
        <div className="nc-vh-sidebar-head">
          <div className="sub">{t('lp.page.version_history', 'Version history')}</div>
          <div className="title nc-ellipsis">{title}</div>
          <div role="button" className="nc-vh-group-btn" aria-label={`Group by ${bucket.short}`} onClick={(e) => openMenu(e.currentTarget, {
            width: 220,
            sections: [{ title: t('lp.page.organize_changes_by', 'Organize changes by'), items: GROUPS.map((g) => ({ label: g.label, checked: g.id === grouping, onSelect: () => setGrouping(g.id) })) }],
          }, { placement: 'bottom-start' })}>
            <span className="muted">{t('lp.page.group_by', 'Group by')}</span>
            <span>{bucket.short}</span>
            <Icon name="chevronDownNarrow" size={14} />
          </div>
        </div>
        <div className="lit-scroller vertical nc-vh-list" role="listbox" aria-label="Version history entries">
          {versions && listed.length === 0 && (
            <div className="nc-vh-empty small">{grouping === 'bookmarks' ? t('lp.page.you_haven_t_bookmarked_any_versions', 'You haven’t bookmarked any versions') : t('lp.page.there_s_no_change_history_yet', 'There’s no change history yet.')}</div>
          )}
          {listed.map((v, i) => (
            <Fragment key={v.id}>
              {/* option, separator, option…: the rule next to the selected/hovered entry is hidden (CSS) */}
              {i > 0 && <div className="nc-vh-sep-wrap"><div className="nc-vh-sep" role="separator" /></div>}
              <div role="option" aria-selected={selected === v.id} className={`nc-vh-entry ${selected === v.id ? 'selected' : ''}`} onClick={() => setSelected(v.id)} data-version-id={v.id}
                onContextMenu={(e) => {
                  // right-click: name / rename the bookmark, copy a link that reopens this version
                  e.preventDefault();
                  setSelected(v.id);
                  const el = e.currentTarget as HTMLElement;
                  const closeMenu = openMenu({ x: e.clientX, y: e.clientY }, { width: 240, sections: [{ items: [
                    { label: bookmarks[v.id] ? t('lp.page.rename_page_version', 'Rename page version') : t('lp.page.name_this_page_version', 'Name this page version'), icon: 'bookmark', onSelect: () => { closeMenu(); if (bookmarks[v.id]) openNameDialog(versionTimestamp(v.createdTime), true, bookmarks[v.id], (name) => void saveBookmark(v, name)); else toggleBookmark(v, el); return false; } },
                    { label: t('lp.page.copy_link_to_version', 'Copy link to version'), icon: 'link', shortcut: '⌘⌥L', onSelect: () => { closeMenu(); copyVersionLink(v.id); return false; } },
                  ] }] });
                }}>
                <div className="row1">
                  <div className="when">{bookmarks[v.id] || versionTimestamp(v.createdTime)}</div>
                  <div className="acts">
                    <div role="button" className={`nc-icon-btn tiny ${bookmarks[v.id] ? 'on' : ''}`} aria-label={t('lp.page.bookmark_this_page_version', 'Bookmark this page version')} data-tooltip={t('lp.page.bookmark_this_page_version', 'Bookmark this page version')}
                      onClick={(e) => { e.stopPropagation(); toggleBookmark(v, e.currentTarget as HTMLElement); }}>
                      <Icon name="bookmark" size={14} />
                    </div>
                    <div role="button" className="nc-icon-btn tiny round" aria-label={t('lp.page.show_every_change_in_this_version', 'Show every change in this version')} data-tooltip={t('lp.page.show_every_change_in_this_version', 'Show every change in this version')}
                      onClick={(e) => { e.stopPropagation(); setSelected(v.id); }}>
                      <Icon name="chevronRight" size={14} />
                    </div>
                  </div>
                </div>
                <div className="authors">
                  {v.authorIds.slice(0, 3).map((id) => (
                    <span key={id} className="author"><span className="dot" /><span className="nc-ellipsis">{userName(records.get<UserRecord>('lit_user', id))}</span></span>
                  ))}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </aside>
      <div className="nc-vh-main">
        <div className="nc-vh-header">
          <div className="left">
            {current && <div className="when">{versionTimestamp(current.createdTime)}</div>}
            {current?.current && <div className="tag">{t('lp.page.current_version', 'Current version')}</div>}
          </div>
          <button
            role="button"
            aria-disabled={restoreDisabled || undefined}
            className="nc-dialog-btn primary nc-vh-restore-btn"
            disabled={restoreDisabled}
            data-tooltip={current?.current ? t('lp.page.the_page_is_already_on_this', 'The page is already on this version') : dbBlocked ? (ownDb?.reason || t('lp.page.full_access_is_required_to_restore', 'Full access is required to restore this database.')) : undefined}
            onClick={() => setRestoring(true)}
          >
            <Icon name="restoreLoop" size={18} />
            {t('lp.page.begin_restore', 'Begin restore')}
          </button>
          <div role="button" className="nc-icon-btn" aria-label={t('lp.page.exit_version_history', 'Exit version history')} data-tooltip={t('lp.page.exit_version_history', 'Exit version history')} onClick={close} style={{ marginInlineStart: 8 }}>
            <Icon name="close" size={20} />
          </div>
        </div>
        <div ref={previewRef} className="lit-scroller vertical nc-vh-preview" onCopy={onPreviewCopy}>
          {error ? <div className="nc-vh-empty">{error}</div>
            : !versions ? <div className="nc-vh-empty">{t('lp.page.loading_page_versions', 'Loading page versions…')}</div>
              : !selected ? <div className="nc-vh-empty">{t('lp.page.pick_any_version_to_see_a', 'Pick any version to see a preview.')}</div>
                : preview ? <SnapshotPage rootId={pageId} blocks={preview.blocks} changed={shownChanged} /> : <div className="nc-vh-empty">{t('lp.page.loading_page_versions', 'Loading page versions…')}</div>}
        </div>
        {restoring && current && (
          <div className="nc-vh-restore-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) setRestoring(false); }}>
            <div className="nc-vh-restore" role="dialog" aria-label={t('lp.page.restore_version', 'Restore version')}>
              <div className="head">
                <div className="line1">{t('lp.page.restore', 'Restore {pageName}', { pageName: title })}</div>
                <div className="line2">{t('lp.page.to', 'To {version}', { version: versionTimestamp(current.createdTime) })}</div>
              </div>
              <div className="section-title">{t('lp.page.what_gets_restored', 'What gets restored')}</div>
              {ownDb ? (
                <DatabaseRestoreItems />
              ) : (
                <>
                  <div className="item">
                    <Icon name="page" size={18} />
                    <div><div className="t">{t('lp.page.all_page_contents', 'All page contents')}</div><div className="d">{t('lp.page.everything_in_the_page_body_such', 'Everything in the page body, such as text and blocks.')}</div></div>
                  </div>
                  <div className="item">
                    <Icon name="emojiFace" size={18} />
                    <div><div className="t">{t('lp.page.page_metadata', 'Page metadata')}</div><div className="d">{t('lp.page.properties_such_as_the_page_icon', 'Properties such as the page icon and cover.')}</div></div>
                  </div>
                </>
              )}
              {preview && <InlineDatabases databases={preview.databases.filter((d) => d.inline)} on={withDatabases} setOn={setWithDatabases} />}
              <div className="reassure">{t('lp.page.other_versions_stay_intact_and_you', 'Other versions stay intact, and you can restore again anytime.')}</div>
              <div className="buttons">
                <button className="nc-dialog-btn outline" onClick={() => setRestoring(false)}>{t('lp.page.cancel_restore', 'Cancel restore')}</button>
                <button className="nc-dialog-btn primary" disabled={busy} onClick={() => void restore()}>{t('lp.page.restore_selected_version', 'Restore selected version')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Name this version" / "Rename this version" dialog. */
function openNameDialog(timestamp: string, rename: boolean, initial: string, onSave: (name: string) => void) {
  openOverlay((close) => <NameDialog timestamp={timestamp} rename={rename} initial={initial} close={close} onSave={onSave} />, { placement: 'middle', backdrop: 'dim' });
}

function NameDialog({ timestamp, rename, initial, close, onSave }: { timestamp: string; rename: boolean; initial: string; close: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const save = () => {
    onSave(name.trim() || timestamp);
    close();
  };
  return (
    <div className="nc-confirm nc-vh-name-dialog" role="dialog" style={{ width: 340 }}>
      <div className="nc-confirm-message">{rename ? t('lp.page.rename_page_version', 'Rename page version') : t('lp.page.name_this_page_version', 'Name this page version')}</div>
      <div className="nc-confirm-description">{rename ? t('lp.page.new_name_for_the_version', 'New name for the {timestamp} version.', { timestamp }) : t('lp.page.adding_a_bookmark_to_the_version', 'Adding a bookmark to the {timestamp} version.', { timestamp })}</div>
      <input className="nc-vh-name-input" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      <div className="nc-confirm-buttons">
        <button className="nc-dialog-btn primary" onClick={save}>{t('lp.page.save', 'Save')}</button>
        <button className="nc-dialog-btn outline" onClick={close}>{t('lp.page.cancel', 'Cancel')}</button>
      </div>
    </div>
  );
}

/** A shared version link (`?vh=<version>`) opens the page's version history at that version. */
export function useVersionLink(pageId: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const u = new URL(location.href);
    const vh = u.searchParams.get('vh');
    if (!vh) return;
    u.searchParams.delete('vh');
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    openVersionHistory(pageId, { snapshotId: expandId(vh) });
  }, [pageId, ready]);
}

// ---------------------------------------------------------------- databases in a version
interface VersionDatabase {
  blockId: string;
  name: string;
  status: 'restored' | 'unchanged' | 'removed' | 'views_only';
  reason?: string;
  owned: boolean;
  rows: number;
  inline: boolean;
}

/** A full-page database: what its restore brings back. */
function DatabaseRestoreItems() {
  const items: [string, string, string][] = [
    ['viewTable', t('lp.page.database_properties', 'Database properties'), t('lp.page.each_property_s_name_type_and', 'Each property’s name, type, and setup.')],
    ['page', t('lp.page.every_record_with_its_property_values', 'Every record with its property values'), t('lp.page.any_editable_records_created_after_this', 'Any editable records created after this version are removed. Their page content comes back only if you select it below.')],
    ['filter', t('lp.page.every_database_view_and_how_it', 'Every database view and how it’s set up'), t('lp.page.covers_names_sorting_and_filters_for', 'Covers names, sorting, and filters for each view.')],
    ['emojiFace', t('lp.page.database_metadata', 'Database metadata'), t('lp.page.database_title_and_description_plus_icon', 'Database title and description, plus icon and cover.')],
  ];
  return (
    <>
      {items.map(([icon, title, desc]) => (
        <div key={title} className="item">
          <Icon name={icon} size={18} />
          <div><div className="t">{title}</div><div className="d">{desc}</div></div>
        </div>
      ))}
    </>
  );
}

/** Inline / linked databases on the page: "Also restore databases on this page" and what happens to each. */
function InlineDatabases({ databases, on, setOn }: { databases: VersionDatabase[]; on: boolean; setOn: (v: boolean) => void }) {
  if (!databases.length) return null;
  const owned = databases.filter((d) => d.owned && d.status !== 'removed');
  const groups: { key: string; title: string; desc?: string; list: VersionDatabase[] }[] = [
    { key: 'restored', title: t('lp.page.will_restore', 'Will restore'), list: owned.filter((d) => on && d.status === 'restored') },
    { key: 'unchanged', title: t('lp.page.will_stay_unchanged', 'Will stay unchanged'), list: owned.filter((d) => !on || d.status === 'unchanged') },
    { key: 'views', title: t('lp.page.restore_views_only', 'Restore views only'), desc: t('lp.page.since_these_databases_belong_to_a', 'Since these databases belong to a different page, restoring only affects their appearance here. Their content stays the same.'), list: databases.filter((d) => d.status === 'views_only') },
    { key: 'removed', title: t('lp.page.will_remove', 'Will remove'), desc: t('lp.page.restoring_will_remove_these_databases_fr', 'Restoring will remove these databases from the page because they were created after this version.'), list: databases.filter((d) => d.status === 'removed') },
  ];
  return (
    <div className="nc-vh-databases">
      {owned.length > 0 && (
        <label className="nc-vh-db-option">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <div>
            <div className="t">{t('lp.page.restore_this_page_s_databases_too', 'Restore this page’s databases too')}</div>
            <div className="d">{t('lp.page.every_database_page_and_its_properties', 'Every database page and its properties will go back to this version, which can affect other people and views of the database. Page content has to be restored separately, one page at a time, from an earlier version.')}</div>
          </div>
        </label>
      )}
      {groups.filter((g) => g.list.length).map((g) => (
        <div key={g.key} className="nc-vh-db-group" data-group={g.key}>
          <div className="section-title">{g.title}</div>
          {g.desc && <div className="d">{g.desc}</div>}
          {g.list.map((d) => (
            <div key={d.blockId} className="nc-vh-db-row" title={d.reason}>
              <Icon name="viewTable" size={16} />
              <span className="nc-ellipsis">{d.name}</span>
              {d.reason && <span className="reason nc-ellipsis">{d.reason}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

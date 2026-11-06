// Settings › Sidebar: workspace tab presets in Default / Optional groups (drag to reorder or move
// between groups), "New tab" editor (name, icon, shortcuts, sections — or start from one of your own tabs), built-in
// presets that can only be previewed or duplicated, Delete → "Deleted" until "Save changes".
// Data helpers: ../sidebarPresets.ts.
import { useEffect, useMemo, useState } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { records } from '../../../lib/store/records.ts';
import { currentSpaceView } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { t } from '../../shell/i18n.ts';
import { layoutOf, type SectionType, type ShortcutType, type SidebarTab, type TabIcon } from '../../shell/sidebar/model.ts';
import { SHORTCUT_ICON, TAB_ICON, sectionLabel, shortcutLabel, tabName } from '../../shell/sidebar/labels.ts';
import { Button, SectionPage, openSubDialog } from '../ui.tsx';
import { saveSpaceSettings, useSpaceAccess } from '../spaceSettings.ts';
import {
  MAX_DEFAULT_PRESETS, MAX_WORKSPACE_PRESETS, litPresets, presetConfig, type SidebarPreset, type SidebarPresetConfig,
} from '../sidebarPresets.ts';
import '../admin.css';

const SHORTCUT_TYPES: ShortcutType[] = ['new_chat', 'library', 'new_page', 'new_meeting_note', 'new_database', 'settings', 'meeting_notes', 'skills', 'my_tasks', 'lit_calendar', 'marketplace'];
const SECTION_TYPES: SectionType[] = ['upcoming_events', 'recents', 'favorites', 'teamspaces', 'shared', 'private', 'chats', 'pinned_chats', 'agents', 'ai_meeting_notes', 'lit_apps'];

type Group = 'default' | 'optional' | 'deleted';

interface Draft {
  cfg: SidebarPresetConfig;
  deleted: string[];
}

function presetName(p: SidebarPreset): string {
  return p.name || tabName({ id: p.id, icon: p.icon, shortcuts: [], sections: [] });
}

function createdBy(p: SidebarPreset): string {
  if (p.litpage) return t('lp.settings.made_by_litpage', 'Built by Litpage');
  const u = p.created_by_id ? records.get<UserRecord>('lit_user', p.created_by_id) : undefined;
  return u ? t('lp.settings.created_by', 'Created by {name}', { name: u.name || u.email }) : t('lp.settings.made_by_this_workspace', 'Made by this workspace');
}

function summary(p: SidebarPreset): string {
  return [
    ...p.shortcuts.map((s) => shortcutLabel(s.type)),
    ...p.sections.map((s) => sectionLabel(s.type)),
  ].join(', ');
}

export function SidebarPresetsSection() {
  const { space, uid } = useSpaceAccess();
  const saved = useMemo(() => presetConfig(space), [space?.settings?.sidebar_presets]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<Draft>({ cfg: saved, deleted: [] });
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ group: Group; index: number } | null>(null);
  useEffect(() => {
    if (!dirty) setDraft({ cfg: saved, deleted: [] });
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!space) return null;

  const all = [...litPresets(), ...draft.cfg.presets];
  const byId = (id: string) => all.find((p) => p.id === id);
  const groupOf = (id: string): Group => (draft.deleted.includes(id) ? 'deleted' : draft.cfg.default.includes(id) ? 'default' : draft.cfg.optional.includes(id) ? 'optional' : 'optional');
  const listed = new Set([...draft.cfg.default, ...draft.cfg.optional, ...draft.deleted]);
  // presets that exist but aren't placed yet show up in Optional
  const optional = [...draft.cfg.optional, ...all.map((p) => p.id).filter((id) => !listed.has(id))];
  const change = (fn: (d: Draft) => Draft) => {
    setDraft((d) => fn(structuredClone(d)));
    setDirty(true);
  };
  const move = (id: string, to: Group, index?: number) => change((d) => {
    d.cfg.default = d.cfg.default.filter((x) => x !== id);
    d.cfg.optional = d.cfg.optional.filter((x) => x !== id);
    d.deleted = d.deleted.filter((x) => x !== id);
    const list = to === 'default' ? d.cfg.default : to === 'optional' ? d.cfg.optional : d.deleted;
    list.splice(index ?? list.length, 0, id);
    return d;
  });
  const problem = (() => {
    if (draft.cfg.default.length < 1 || draft.cfg.default.length > MAX_DEFAULT_PRESETS) return t('lp.settings.to_save_you_need_one_to', 'To save, you need one to six default presets');
    if (draft.cfg.presets.some((p) => !draft.deleted.includes(p.id) && !(p.name ?? '').trim())) return t('lp.settings.name_each_preset_before_saving', 'Name each preset before saving');
    return '';
  })();
  const save = () => {
    if (problem) return;
    const keep = draft.cfg.presets.filter((p) => !draft.deleted.includes(p.id));
    saveSpaceSettings(space.id, {
      sidebar_presets: { presets: keep, default: draft.cfg.default, optional: optional.filter((id) => !draft.deleted.includes(id) && byId(id)) },
    });
    setDirty(false);
    useUI.getState().toast(t('lp.settings.sidebar_presets_saved', 'Sidebar presets saved'));
  };
  const reset = () => {
    setDraft({ cfg: saved, deleted: [] });
    setDirty(false);
  };
  const addPreset = (p: SidebarPreset, to: Group = 'optional') => {
    if (draft.cfg.presets.length >= MAX_WORKSPACE_PRESETS) {
      useUI.getState().toast(t('lp.settings.a_workspace_can_have_at_most', 'A workspace can have at most {limit, number} presets', { limit: MAX_WORKSPACE_PRESETS }));
      return;
    }
    change((d) => {
      d.cfg.presets.push(p);
      (to === 'default' ? d.cfg.default : d.cfg.optional).push(p.id);
      return d;
    });
  };
  const newPreset = () => openSubDialog((close) => <PresetEditor close={close} onSave={(p) => addPreset({ ...p, id: `preset-${newId().slice(0, 8)}`, created_by_id: uid, created_time: Date.now() })} />);
  const rowMenu = (anchor: HTMLElement, p: SidebarPreset, group: Group) => {
    const items = group === 'deleted'
      ? [{ label: t('lp.settings.restore_preset', 'Restore preset'), icon: 'arrowTurnUpLeft', onSelect: () => move(p.id, 'optional') }]
      : [
        { label: t('lp.settings.preview', 'Preview'), icon: 'eye', onSelect: () => { openSubDialog((close) => <PresetPreview preset={p} close={close} />); } },
        ...(p.litpage ? [] : [
          { label: t('lp.settings.rename', 'Rename'), icon: 'pencilSmall', onSelect: () => { openSubDialog((close) => <PresetEditor close={close} initial={p} onSave={(np) => change((d) => { d.cfg.presets = d.cfg.presets.map((x) => (x.id === p.id ? { ...x, ...np } : x)); return d; })} />); } },
        ]),
        { label: t('lp.settings.duplicate', 'Duplicate'), icon: 'duplicate', onSelect: () => addPreset({ ...structuredClone(p), litpage: undefined, id: `preset-${newId().slice(0, 8)}`, name: `${presetName(p)} (1)`, created_by_id: uid, created_time: Date.now() }) },
        group === 'default'
          ? { label: t('lp.settings.move_to_optional', 'Move to Optional'), icon: 'arrowStraightDownSmall', disabled: draft.cfg.default.length <= 1, onSelect: () => move(p.id, 'optional') }
          : { label: t('lp.settings.move_to_default', 'Move to Default'), icon: 'arrowStraightUpFill', disabled: draft.cfg.default.length >= MAX_DEFAULT_PRESETS, onSelect: () => move(p.id, 'default') },
        ...(p.litpage ? [] : [{ label: t('lp.settings.delete_preset', 'Delete preset'), icon: 'trashSmall', danger: true, disabled: group === 'default' && draft.cfg.default.length <= 1, onSelect: () => move(p.id, 'deleted') }]),
      ];
    openMenu(anchor, { width: 230, sections: [{ items }] }, { placement: 'bottom-end' });
  };
  const renderGroup = (group: Group, ids: string[], title: string, sub: string, empty: string) => (
    <div
      className="nc-set-preset-group"
      data-group={group}
      onDragOver={(e) => { if (drag && group !== 'deleted') { e.preventDefault(); if (!ids.length) setOver({ group, index: 0 }); } }}
      onDrop={(e) => {
        e.preventDefault();
        if (drag && over && group !== 'deleted') {
          const p = byId(drag);
          if (group === 'default' && groupOf(drag) !== 'default' && draft.cfg.default.length >= MAX_DEFAULT_PRESETS) useUI.getState().toast(t('lp.settings.to_save_you_need_one_to', 'To save, you need one to six default presets'));
          else if (group !== 'default' && groupOf(drag) === 'default' && draft.cfg.default.length <= 1) useUI.getState().toast(t('lp.settings.keep_one_or_more_default_presets', 'Keep one or more default presets'));
          else if (p) {
            const cur = ids.indexOf(drag);
            move(drag, group, cur >= 0 && cur < over.index ? over.index - 1 : over.index);
          }
        }
        setDrag(null);
        setOver(null);
      }}
    >
      <div className="ghead">{title}<span className="gsub">{sub}</span></div>
      {!ids.length && <div className="gempty">{empty}</div>}
      {ids.map((id, i) => {
        const p = byId(id);
        if (!p) return null;
        return (
          <div
            key={id}
            className={`nc-set-preset ${drag === id ? 'dragging' : ''} ${over?.group === group && over.index === i && drag !== id ? 'drop-before' : ''} ${group === 'deleted' ? 'deleted' : ''}`}
            data-preset-id={id}
            draggable={group !== 'deleted'}
            onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={(e) => {
              if (!drag || group === 'deleted') return;
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setOver({ group, index: e.clientY > r.top + r.height / 2 ? i + 1 : i });
            }}
          >
            {group !== 'deleted' && <span className="grip" aria-hidden><Icon name="gripVertical" size={14} /></span>}
            <span className="icon"><Icon name={TAB_ICON[p.icon] ?? 'sidebarTabCustom'} size={18} /></span>
            <div className="main">
              <span className="name">{presetName(p)}</span>
              <span className="meta">{createdBy(p)}{summary(p) ? ` · ${summary(p)}` : ''}</span>
            </div>
            {group !== 'deleted' && (
              <>
                <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.move_up', 'Move up')} data-tooltip={t('lp.settings.move_up', 'Move up')} onClick={() => i > 0 && move(id, group, i - 1)}><Icon name="arrowStraightUpFill" size={12} /></span>
                <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.move_down', 'Move down')} data-tooltip={t('lp.settings.move_down', 'Move down')} onClick={() => i < ids.length - 1 && move(id, group, i + 1)}><Icon name="arrowStraightDownFill" size={12} /></span>
              </>
            )}
            <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more_options_for', 'Additional options for {name}', { name: presetName(p) })} onClick={(e) => rowMenu(e.currentTarget as HTMLElement, p, group)}>
              <Icon name="ellipsisSmall" size={16} />
            </span>
          </div>
        );
      })}
    </div>
  );
  return (
    <SectionPage
      title={t('lp.settings.sidebar', 'Sidebar')}
      subtitle={t('lp.settings.control_the_sidebar_s_contents_and', 'Control the sidebar’s contents and behavior')}
      headerExtra={<div><Button variant="primary" icon="plusSmall" onClick={newPreset}>{t('lp.settings.new_tab', 'New tab')}</Button></div>}
    >
      <div className="nc-set-presets">
        <div className="nc-set-group-title">{t('lp.settings.tab_presets', 'Tab presets')}</div>
        {renderGroup('default', draft.cfg.default, t('lp.settings.default_tabs', 'Default tabs'), t('lp.settings.this_preset_is_applied_to_everyone', 'This preset is applied to everyone who joins'), t('lp.settings.there_aren_t_any_default_presets', 'There aren’t any default presets'))}
        {renderGroup('optional', optional.filter((id) => !draft.deleted.includes(id)), t('lp.settings.optional_tabs', 'Optional tabs'), t('lp.settings.members_may_add_this_preset', 'Members may add this preset'), t('lp.settings.there_aren_t_any_optional_presets', 'There aren’t any optional presets'))}
        {draft.deleted.length > 0 && renderGroup('deleted', draft.deleted, t('lp.settings.deleted', 'Deleted'), '', '')}
        {dirty && (
          <div className="nc-set-savebar">
            <span className="msg">{problem}</span>
            <Button onClick={reset}>{t('lp.settings.reset_changes', 'Reset changes')}</Button>
            <Button variant="primary" disabled={!!problem} onClick={save}>{t('lp.settings.save_changes', 'Save changes')}</Button>
          </div>
        )}
      </div>
    </SectionPage>
  );
}

function PresetPreview({ preset, close }: { preset: SidebarPreset; close: () => void }) {
  return (
    <>
      <h3>{presetName(preset)}</h3>
      {preset.litpage && <div className="desc">{t('lp.settings.litpage_presets_aren_t_editable', 'Litpage presets aren’t editable.')}</div>}
      <TabPreview tab={preset} />
      <div className="actions"><Button onClick={close}>{t('lp.settings.exit_preview', 'Exit preview')}</Button></div>
    </>
  );
}

function TabPreview({ tab }: { tab: Pick<SidebarTab, 'shortcuts' | 'sections'> }) {
  return (
    <div className="nc-set-preset-preview" aria-label={t('lp.settings.preview', 'Preview')}>
      {tab.shortcuts.map((s) => <div key={s.id} className="pi"><Icon name={SHORTCUT_ICON[s.type] ?? 'page'} size={16} />{shortcutLabel(s.type)}</div>)}
      {tab.sections.map((s) => <div key={s.id} className="ps">{sectionLabel(s.type)}</div>)}
      {!tab.shortcuts.length && !tab.sections.length && <div className="pi">—</div>}
    </div>
  );
}

function PresetEditor({ close, initial, onSave }: { close: () => void; initial?: SidebarPreset; onSave: (p: SidebarPreset) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState<TabIcon>(initial?.icon ?? 'custom');
  const [shortcuts, setShortcuts] = useState<ShortcutType[]>(initial?.shortcuts.map((s) => s.type) ?? ['new_page']);
  const [sections, setSections] = useState<SectionType[]>(initial?.sections.map((s) => s.type) ?? ['recents', 'favorites']);
  const mine = layoutOf(currentSpaceView()).tabs;
  const fromTab = (tab: SidebarTab) => {
    setName(tabName(tab));
    setIcon(tab.icon);
    setShortcuts(tab.shortcuts.filter((s) => SHORTCUT_TYPES.includes(s.type)).map((s) => s.type));
    setSections(tab.sections.filter((s) => SECTION_TYPES.includes(s.type)).map((s) => s.type));
  };
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const preset: SidebarPreset = {
    id: initial?.id ?? 'draft',
    name: name.trim(),
    icon,
    shortcuts: shortcuts.map((type, i) => ({ id: initial?.shortcuts.find((s) => s.type === type)?.id ?? `sc-${type}-${i}`, type })),
    sections: sections.map((type, i) => ({ id: initial?.sections.find((s) => s.type === type)?.id ?? `sec-${type}-${i}`, type, limit: type === 'favorites' ? 100 : type === 'chats' ? 20 : 5 })),
    created_by_id: initial?.created_by_id,
    created_time: initial?.created_time,
  };
  return (
    <div className="nc-set-preset-editor">
      <h3>{initial ? t('lp.settings.rename', 'Rename') : t('lp.settings.new_tab', 'New tab')}</h3>
      <div className="nc-set-toolbar">
        <div role="button" className="nc-set-btn" aria-label={t('lp.settings.icon', 'Icon')} onClick={(e) => openMenu(e.currentTarget, {
          width: 200,
          sections: [{ items: (['home', 'chat', 'meetings', 'custom'] as TabIcon[]).map((ic) => ({ label: tabName({ id: ic, icon: ic, shortcuts: [], sections: [] }), icon: TAB_ICON[ic], checked: icon === ic, onSelect: () => setIcon(ic) })) }],
        }, { placement: 'bottom-start' })}
        >
          <Icon name={TAB_ICON[icon]} size={16} />
        </div>
        <div className="nc-set-input" style={{ flex: 1 }}><input autoFocus aria-label={t('lp.settings.name', 'Name')} placeholder={t('lp.settings.new_tab', 'New tab')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></div>
        {!initial && mine.length > 0 && (
          <Button onClick={(e) => openMenu(e.currentTarget, { width: 220, sections: [{ title: t('lp.settings.start_from_your_tab', 'Start from your tab'), items: mine.map((tab) => ({ label: tabName(tab), icon: TAB_ICON[tab.icon], onSelect: () => fromTab(tab) })) }] }, { placement: 'bottom-end' })}>
            {t('lp.settings.use_my_tab', 'Use my tab')}
          </Button>
        )}
      </div>
      <div className="nc-set-label">{t('lp.settings.shortcuts', 'Shortcuts')}</div>
      <div className="opts">
        {SHORTCUT_TYPES.map((s) => <label key={s} className="opt"><input type="checkbox" checked={shortcuts.includes(s)} onChange={() => setShortcuts((l) => toggle(l, s))} /><Icon name={SHORTCUT_ICON[s]} size={16} />{shortcutLabel(s)}</label>)}
      </div>
      <div className="nc-set-label">{t('lp.settings.sections', 'Sections')}</div>
      <div className="opts">
        {SECTION_TYPES.map((s) => <label key={s} className="opt"><input type="checkbox" checked={sections.includes(s)} onChange={() => setSections((l) => toggle(l, s))} />{sectionLabel(s)}</label>)}
      </div>
      <TabPreview tab={preset} />
      <div className="actions">
        <Button variant="primary" disabled={!name.trim()} onClick={() => { onSave(preset); close(); }}>{t('lp.settings.save', 'Save')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </div>
  );
}


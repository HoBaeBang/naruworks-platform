// Settings › Emoji: "N emojis", search by name / added by,
// Add emoji (upload + name → api('addCustomEmoji')), Image / Name / Added by / Date added table (sortable),
// row ••• → Edit (rename) / Delete. Stored in space.settings.custom_emojis.
import { useRef, useState } from 'react';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { uploadFile } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { t } from '../../shell/i18n.ts';
import { Button, Row, SectionPage, Switch, confirmDialog, openSubDialog } from '../ui.tsx';
import { saveSpaceSettings, spaceApi, spaceSetting, useSpaceAccess } from '../spaceSettings.ts';
import { fmtDate } from './workspace.tsx';

export interface CustomEmoji { id: string; name: string; url: string; created_by_id: string; created_time: number }

const NAME_RE = /^[a-z0-9_-]{1,49}$/;

function userName(id: string): string {
  const u = records.get<UserRecord>('lit_user', id);
  return u?.name || u?.email || '—';
}

export function EmojiSection() {
  const { space, uid, admin, owner } = useSpaceAccess();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<{ by: 'name' | 'date'; desc: boolean }>({ by: 'date', desc: true });
  if (!space) return null;
  const all = spaceSetting<CustomEmoji[]>(space, 'custom_emojis', []);
  const adminOnly = spaceSetting(space, 'emoji_admin_only', false);
  const canAdd = admin || !adminOnly;
  const needle = q.trim().toLowerCase();
  const list = all
    .filter((e) => !needle || e.name.toLowerCase().includes(needle) || userName(e.created_by_id).toLowerCase().includes(needle))
    .sort((a, b) => {
      const c = sort.by === 'name' ? a.name.localeCompare(b.name) : a.created_time - b.created_time;
      return sort.desc ? -c : c;
    });
  const toggleSort = (by: 'name' | 'date') => setSort((s) => (s.by === by ? { by, desc: !s.desc } : { by, desc: by === 'date' }));

  const rowMenu = (anchor: HTMLElement, e: CustomEmoji) => {
    const mine = e.created_by_id === uid || admin;
    openMenu(anchor, {
      width: 200,
      sections: [{
        items: [
          { label: t('lp.settings.edit', 'Edit'), icon: 'pencilSmall', disabled: !mine, onSelect: () => { openEmojiDialog(space, all, e); } },
          {
            label: t('lp.settings.delete', 'Delete'),
            icon: 'trashSmall',
            danger: true,
            disabled: !mine,
            onSelect: () => {
              void confirmDialog({
                title: t('lp.settings.remove_this_emoji', 'Remove this emoji?'),
                description: t('lp.settings.everyone_in_your_workspace_will_lose', 'Everyone in your workspace will lose it'),
                confirmLabel: t('lp.settings.delete', 'Delete'),
                danger: true,
              }).then(async (ok) => {
                if (!ok) return;
                try {
                  await spaceApi('removeCustomEmoji', { spaceId: space.id, emojiId: e.id });
                } catch {
                  useUI.getState().toast(t('lp.settings.the_emoji_wasn_t_deleted_give', 'The emoji wasn’t deleted. Give it another try.'));
                }
              });
            },
          },
        ],
      }],
    }, { placement: 'bottom-end' });
  };

  return (
    <SectionPage title={t('lp.settings.emoji', 'Emoji')} subtitle={t('lp.settings.browse_your_workspace_s_emojis_and', 'Browse your workspace’s emojis and upload more')}>
      {owner && (
        <Row
          id="emoji-admin-only"
          label={t('lp.settings.only_workspace_owners_can_create_custom', 'Only workspace owners can create custom emojis')}
          description={t('lp.settings.people_who_added_existing_emojis_can', 'People who added existing emojis can still edit or delete them')}
          control={<Switch label="Limit custom emoji creation" checked={adminOnly} onChange={(v) => saveSpaceSettings(space.id, { emoji_admin_only: v })} />}
        />
      )}
      <div>
        <div className="nc-set-emoji-head">
          <div className="nc-set-emoji-count">{t('lp.settings.totalcount_plural_one_other', '{totalCount, plural, one {# uploaded emoji} other {# uploaded emojis}}', { totalCount: all.length })}</div>
          <div className="nc-set-people-actions">
            {searching ? (
              <div className="nc-set-input nc-set-people-search">
                <Icon name="magnifyingGlassSmall" size={16} />
                <input
                  autoFocus
                  aria-label={t('lp.settings.find_an_emoji_by_name_or', 'Find an emoji by name or uploader')}
                  placeholder={t('lp.settings.find_an_emoji_by_name_or', 'Find an emoji by name or uploader')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onBlur={() => { if (!q) setSearching(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setSearching(false); } }}
                />
              </div>
            ) : (
              <span role="button" tabIndex={0} className="nc-set-icon-btn lg" aria-label={t('lp.settings.find_an_emoji_by_name_or', 'Find an emoji by name or uploader')} onClick={() => setSearching(true)}>
                <Icon name="magnifyingGlass" size={20} />
              </span>
            )}
            <span data-tooltip={canAdd ? undefined : t('lp.settings.this_workspace_has_no_custom_emojis', 'This workspace has no custom emojis. Ask a workspace owner to add one or let members add them.')}>
              <Button variant="primary" disabled={!canAdd} onClick={() => openEmojiDialog(space, all, null)}>{t('lp.settings.add_emoji', 'Add emoji')}</Button>
            </span>
          </div>
        </div>
        {all.length ? (
          <table className="nc-set-etable">
            <thead>
              <tr>
                <th style={{ width: 80 }}>{t('lp.settings.image', 'Image')}</th>
                <th>
                  <span role="button" className="sort" onClick={() => toggleSort('name')}>
                    {t('lp.settings.name', 'Name')}
                    {sort.by === 'name' && <Icon name={sort.desc ? 'arrowStraightDownFill' : 'arrowStraightUpFill'} size={12} />}
                  </span>
                </th>
                <th>{t('lp.settings.added_by', 'Added by')}</th>
                <th style={{ width: 150 }}>
                  <span role="button" className="sort" onClick={() => toggleSort('date')}>
                    {t('lp.settings.date_added', 'Date added')}
                    {sort.by === 'date' && <Icon name={sort.desc ? 'arrowStraightDownFill' : 'arrowStraightUpFill'} size={12} />}
                  </span>
                </th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} data-emoji={e.name}>
                  <td><img src={e.url} alt={`:${e.name}:`} /></td>
                  <td className="name">{e.name}</td>
                  <td>{userName(e.created_by_id)}</td>
                  <td>{fmtDate(e.created_time)}</td>
                  <td>
                    <span role="button" tabIndex={0} className="nc-set-icon-btn row-more" aria-label={t('lp.settings.more_actions', 'More actions')} onClick={(ev) => rowMenu(ev.currentTarget as HTMLElement, e)}>
                      <Icon name="ellipsisSmall" size={16} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="nc-set-empty-card">
            <div>{canAdd ? t('lp.settings.this_workspace_has_no_custom_emojis_a728', 'This workspace has no custom emojis. Add your first one to begin.') : t('lp.settings.this_workspace_has_no_custom_emojis', 'This workspace has no custom emojis. Ask a workspace owner to add one or let members add them.')}</div>
            {canAdd && <Button onClick={() => openEmojiDialog(space, all, null)}>{t('lp.settings.add_emoji', 'Add emoji')}</Button>}
          </div>
        )}
        {all.length > 0 && !list.length && <div className="nc-set-empty">{t('lp.settings.no_results', 'No results')}</div>}
      </div>
    </SectionPage>
  );
}

function openEmojiDialog(space: SpaceRecord, all: CustomEmoji[], editing: CustomEmoji | null) {
  openSubDialog((close) => <EmojiBody space={space} all={all} editing={editing} close={close} />);
}

function EmojiBody({ space, all, editing, close }: { space: SpaceRecord; all: CustomEmoji[]; editing: CustomEmoji | null; close: () => void }) {
  const [url, setUrl] = useState(editing?.url ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const n = name.trim().toLowerCase().replace(/\s+/g, '-');
  const nameErr = !n ? '' : n.length >= 50
    ? t('lp.settings.keep_the_name_under_50_characters', 'Keep the name under 50 characters')
    : !NAME_RE.test(n)
      ? t('lp.settings.stick_to_lowercase_letters_digits_hyphen', 'Stick to lowercase letters, digits, hyphens, and underscores in the name')
      : all.some((e) => e.name === n && e.id !== editing?.id)
        ? t('lp.settings.that_name_is_already_in_use', 'That name is already in use')
        : '';

  const onFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setErr(t('lp.settings.only_image_files_are_supported', 'Only image files are supported'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const up = await uploadFile(f, f.name, space.id);
      setUrl(up.url);
      if (!name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48));
    } catch (e: any) {
      setErr(e?.message ?? t('lp.settings.the_emoji_wasn_t_saved_give', 'The emoji wasn’t saved. Give it another try.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!url || !n || nameErr) return;
    setBusy(true);
    try {
      if (editing) await spaceApi('editCustomEmoji', { spaceId: space.id, emojiId: editing.id, name: n, url });
      else await spaceApi('addCustomEmoji', { spaceId: space.id, name: n, url });
      close();
    } catch (e: any) {
      setErr(e?.message ?? t('lp.settings.the_emoji_wasn_t_saved_give', 'The emoji wasn’t saved. Give it another try.'));
      setBusy(false);
    }
  };

  return (
    <div
      className="nc-set-emoji-dialog"
      aria-label={editing ? t('lp.settings.edit_a_custom_emoji', 'Edit a custom emoji') : t('lp.settings.add_a_custom_emoji', 'Add a custom emoji')}
      onPaste={(e) => {
        const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
        if (f) { e.preventDefault(); void onFile(f); }
      }}
    >
      <h3>{editing ? t('lp.settings.edit_a_custom_emoji', 'Edit a custom emoji') : t('lp.settings.add_a_custom_emoji', 'Add a custom emoji')}</h3>
      <div className="desc">{t('lp.settings.anyone_in_your_workspace_can_use', 'Anyone in your workspace can use custom emojis')}</div>
      <div
        className={`nc-set-emoji-drop ${url ? 'has' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files?.[0]); }}
      >
        {url ? (
          <div className="preview">
            <img src={url} alt="" />
            <div className="cap">{t('lp.settings.preview', 'Preview')} · <span className="mono">:{n || 'emoji'}:</span></div>
          </div>
        ) : <Icon name="imagePlus" size={28} style={{ color: 'var(--lp-icon-tertiary)' }} />}
        <Button small onClick={() => fileRef.current?.click()}>{url ? t('lp.settings.replace', 'Replace') : t('lp.settings.upload_an_image', 'Choose an image')}</Button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div>
        <label className="nc-set-label">{t('lp.settings.emoji_name', 'Emoji name')}</label>
        <div className="nc-set-input">
          <input value={name} placeholder={t('lp.settings.team_high_five', 'team-high-five')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
        </div>
      </div>
      {(nameErr || err) && <div className="error">{nameErr || err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy || !url || !n || !!nameErr} onClick={() => void save()}>{t('lp.settings.save', 'Save')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </div>
  );
}

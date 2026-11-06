// Share › Publish › "Customize site styling": site customization. Changes apply to every page of the site and are
// saved with "Publish changes" (server `setSiteSettings`, full access only).
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, Permission } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../lib/api.ts';
import { getBlock } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { Toggle } from './ExportDialog.tsx';
import { openIconPicker } from './IconPicker.tsx';
import { pageTitle } from './pageActions.ts';
import './dialogs.css';
import './share.css';

export interface SiteSettingsValue {
  slug?: string;
  theme?: 'system' | 'light' | 'dark';
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  header?: { breadcrumbs?: boolean; search?: boolean; share?: boolean; signup?: boolean; links?: { pageId: string }[] };
  ga?: string;
}

const MAX_LINKS = 10;

/** Site settings stored on the page's live Publish permission. */
export function siteSettingsOf(page: BlockRecord | undefined): SiteSettingsValue {
  const perm = (page?.permissions ?? []).find((p: Permission) => p.type === 'public_permission' && p.published) as (Permission & { site?: SiteSettingsValue }) | undefined;
  return perm?.site ?? {};
}

export function openSiteSettings(rootId: string) {
  openOverlay((close) => <SiteSettingsDialog rootId={rootId} close={close} />, { placement: 'middle', backdrop: 'dim' });
}

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="nc-site-section">
      <div className="nc-site-section-title">{title}</div>
      {caption && <div className="nc-site-section-caption">{caption}</div>}
      {children}
    </section>
  );
}

function SiteSettingsDialog({ rootId, close }: { rootId: string; close: () => void }) {
  const root = getBlock(rootId);
  const initial = useMemo(() => siteSettingsOf(root), [root]);
  const [s, setS] = useState<SiteSettingsValue>(() => ({
    ...initial,
    theme: initial.theme ?? 'system',
    favicon: initial.favicon ?? 'page_icon',
    header: { breadcrumbs: true, search: true, share: false, signup: true, links: [], ...(initial.header ?? {}) },
  }));
  const [slugState, setSlugState] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (p: Partial<SiteSettingsValue>) => setS((x) => ({ ...x, ...p }));
  const setHeader = (p: Partial<NonNullable<SiteSettingsValue['header']>>) => setS((x) => ({ ...x, header: { ...(x.header ?? {}), ...p } }));
  const title = pageTitle(root) || 'Untitled';
  const url = `${location.origin}/public/${s.slug || ''}`;

  useEffect(() => {
    const slug = (s.slug ?? '').trim();
    if (!slug || slug === initial.slug) {
      setSlugState(null);
      return;
    }
    const timer = setTimeout(() => {
      void api<{ available: boolean; reason?: string }>('checkSiteSlug', { pageId: rootId, slug }).then((r) => setSlugState({ ok: r.available, reason: r.reason })).catch(() => setSlugState(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [s.slug, initial.slug, rootId]);

  const upload = async (accept: string, onUrl: (url: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const up = await uploadFile(f, f.name, root?.space_id ?? useSession.getState().spaceId ?? '');
        onUrl(up.url);
      } catch (e: any) {
        useUI.getState().toast(e?.message ?? t('lp.page.couldn_t_upload_the_preview_image', 'Couldn’t upload the preview image'));
      }
    };
    input.click();
  };

  const addLink = (anchor: HTMLElement) => {
    // pages of the site: the root and the pages under it that are loaded
    const inSite = (b: BlockRecord | undefined): boolean => {
      let cur = b;
      for (let i = 0; i < 40 && cur; i++) {
        if (cur.id === rootId) return true;
        cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : cur.parent_table === 'collection' ? getBlock((records.get('collection', cur.parent_id) as any)?.parent_id) : undefined;
      }
      return false;
    };
    const pages = records.all<BlockRecord>('block').filter((b) => b.alive && (b.type === 'page' || b.type === 'collection_view_page') && inSite(b) && !(s.header?.links ?? []).some((l) => l.pageId === b.id));
    // picking a page closes only this menu (Menu closes every overlay unless onSelect returns false)
    const closeMenu = openMenu(anchor, {
      width: 280,
      search: t('lp.page.choose_a_page', 'Choose a page'),
      sections: [{
        items: pages.length
          ? pages.slice(0, 200).map((b) => ({ label: pageTitle(b) || 'Untitled', icon: <PageIcon block={b} size={20} />, onSelect: () => { setHeader({ links: [...(s.header?.links ?? []), { pageId: b.id }] }); closeMenu(); return false; } }))
          : [{ label: t('lp.page.your_site_s_other_published_pages', 'Your site’s other published pages will show up here'), disabled: true }],
      }],
    }, { placement: 'bottom-start' });
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api<{ recordMap: any }>('setSiteSettings', { pageId: rootId, settings: s });
      records.mergeRecordMap(res.recordMap);
      useUI.getState().toast(t('lp.page.changes_published', 'Changes published'));
      close();
    } catch (e: any) {
      setErr(e?.message ?? t('lp.page.an_error_occurred_try_again_in', 'An error occurred. Try again in a little while'));
      setBusy(false);
    }
  };

  const links = s.header?.links ?? [];
  return (
    <div className="nc-site-settings" role="dialog" aria-label={t('lp.page.site_customization', 'Site customization')}>
      <header className="nc-site-settings-top">
        <div>
          <div className="nc-site-settings-title">{t('lp.page.site_customization', 'Site customization')}</div>
          <div className="nc-site-settings-caption">{t('lp.page.changes_apply_to_every_page_on', 'Changes apply to every page on this site')}</div>
        </div>
        <div className="nc-site-settings-actions">
          <button type="button" className="nc-dialog-btn outline" onClick={close}>{t('lp.page.cancel', 'Cancel')}</button>
          <button type="button" className="nc-dialog-btn primary" disabled={busy || slugState?.ok === false} onClick={() => void save()}>{t('lp.page.publish_changes', 'Publish changes')}</button>
        </div>
      </header>
      <div className="nc-site-settings-body lit-scroller vertical">
        {err && <div className="nc-site-error">{err}</div>}
        <Section title={t('lp.page.site_link', 'Site link')}>
          <div className="nc-site-slug">
            <span className="prefix nc-ellipsis">{location.host}/public/</span>
            <input aria-label="Short link" placeholder={title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-site'} value={s.slug ?? ''} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
          </div>
          {slugState && <div className={`nc-site-hint ${slugState.ok ? 'ok' : 'bad'}`}>{slugState.ok ? t('lp.page.available', 'Available') : slugState.reason}</div>}
        </Section>

        <Section title={t('lp.page.theme', 'Theme')}>
          <div className="nc-site-segment" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((th) => (
              <div key={th} role="radio" aria-checked={s.theme === th} className={`opt ${s.theme === th ? 'on' : ''}`} onClick={() => set({ theme: th })}>
                {th === 'system' ? t('lp.page.system', 'System') : th === 'light' ? t('lp.page.light', 'Light') : t('lp.page.dark', 'Dark')}
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('lp.page.share_preview', 'Share preview')} caption={t('lp.page.image_people_see_when_your_site', 'Image people see when your site link is posted on social platforms like X or LinkedIn')}>
          <label className="nc-site-field">
            <span>{t('lp.page.link_title', 'Link title')}</span>
            <input value={s.title ?? ''} placeholder={title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="nc-site-field">
            <span>{t('lp.page.description', 'Description')}</span>
            <textarea value={s.description ?? ''} maxLength={300} rows={2} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="nc-site-image-row">
            {s.image ? <img className="nc-site-image" src={s.image} alt="" /> : <div className="nc-site-image empty"><Icon name="image" size={20} /></div>}
            <button type="button" className="nc-dialog-btn outline" onClick={() => void upload('image/*', (u) => set({ image: u }))}>{t('lp.page.upload_image', 'Upload image')}</button>
            {s.image && <button type="button" className="nc-dialog-btn outline" onClick={() => set({ image: undefined })}>{t('lp.page.reset', 'Reset')}</button>}
          </div>
          <div className="nc-site-seo-preview" aria-label={t('lp.page.seo_preview', 'SEO preview')}>
            <div className="url nc-ellipsis">{url}</div>
            <div className="ttl nc-ellipsis">{s.title || title}</div>
            <div className="desc">{s.description || ''}</div>
          </div>
        </Section>

        <Section title={t('lp.page.favicon', 'Favicon')}>
          <div className="nc-site-segment" role="radiogroup" aria-label="Favicon">
            <div role="radio" aria-checked={s.favicon === 'page_icon'} className={`opt ${s.favicon === 'page_icon' ? 'on' : ''}`} onClick={() => set({ favicon: 'page_icon' })}>{t('lp.page.page_icon', 'Page icon')}</div>
            <div role="radio" aria-checked={s.favicon === 'litpage'} className={`opt ${s.favicon === 'litpage' ? 'on' : ''}`} onClick={() => set({ favicon: 'litpage' })}>{t('lp.page.litpage_logo', 'Litpage logo')}</div>
            <div role="radio" aria-checked={!!s.favicon && s.favicon !== 'page_icon' && s.favicon !== 'litpage'} className={`opt ${s.favicon && s.favicon !== 'page_icon' && s.favicon !== 'litpage' ? 'on' : ''}`}
              onClick={(e) => openIconPicker(e.currentTarget, { current: s.favicon, onPick: (v) => set({ favicon: v ?? 'page_icon' }) })}>
              {s.favicon && s.favicon !== 'page_icon' && s.favicon !== 'litpage' ? <PageIcon icon={s.favicon} size={16} /> : null}
              {t('lp.page.custom', 'Custom')}
            </div>
          </div>
          <div className="nc-site-hint">{t('lp.page.works_best_at_32_x_32', 'Works best at 32 x 32')}</div>
        </Section>

        <Section title={t('lp.page.header', 'Header')}>
          {([
            ['breadcrumbs', t('lp.page.breadcrumbs', 'Breadcrumbs'), t('lp.page.show_page_breadcrumbs_in_the_header', 'Show page breadcrumbs in the header’s top-left corner')],
            ['search', t('lp.page.search', 'Search'), t('lp.page.let_visitors_search_your_site_content', 'Let visitors search your site content')],
            ['share', t('lp.page.share', 'Share'), t('lp.page.let_visitors_share_your_site', 'Let visitors share your site')],
            ['signup', t('lp.page.display_a_litpage_signup_button', 'Display a Litpage signup button'), t('lp.page.choose_whether_your_site_displays_the', 'Choose whether your site displays the ‘Get Litpage Free’ button')],
          ] as const).map(([k, label, tip]) => (
            <div key={k} className="nc-setting-row" data-tooltip={tip}>
              <div className="label">{label}</div>
              <Toggle on={!!s.header?.[k]} label={label} onChange={(v) => setHeader({ [k]: v })} />
            </div>
          ))}
        </Section>

        <Section title={t('lp.page.navigation', 'Navigation')} caption={t('lp.page.let_visitors_navigate_easily_to_other', 'Let visitors navigate easily to other pages on this site')}>
          {links.map((l) => {
            const b = getBlock(l.pageId);
            return (
              <div key={l.pageId} className="nc-site-link-row">
                {b && <PageIcon block={b} size={18} />}
                <span className="nc-ellipsis">{pageTitle(b) || 'Untitled'}</span>
                <span role="button" className="nc-icon-btn small" aria-label={t('lp.page.unlink_page', 'Unlink page')} onClick={() => setHeader({ links: links.filter((x) => x.pageId !== l.pageId) })}>
                  <Icon name="close" size={12} />
                </span>
              </div>
            );
          })}
          <div
            role="button"
            className={`nc-site-add-link ${links.length >= MAX_LINKS ? 'disabled' : ''}`}
            data-tooltip={links.length >= MAX_LINKS ? t('lp.page.at_most_page_shortcuts', 'At most {maximumLinks} page shortcuts', { maximumLinks: MAX_LINKS }) : undefined}
            onClick={(e) => links.length < MAX_LINKS && addLink(e.currentTarget)}
          >
            <Icon name="plus" size={14} />{t('lp.page.add_page', 'Add page')}
          </div>
          <div className="nc-site-hint">{t('lp.page.the_header_can_hold_up_to', 'The header can hold up to {maximumLinks} pages', { maximumLinks: MAX_LINKS })}</div>
        </Section>

        <Section title={t('lp.page.google_analytics', 'Google Analytics')} caption={t('lp.page.to_track_your_site_enter_a', 'To track your site, enter a Google Analytics measurement ID, then publish your changes')}>
          <label className="nc-site-field">
            <span>{t('lp.page.measurement_id', 'Measurement ID')}</span>
            <input value={s.ga ?? ''} placeholder="G-XXXXXXXXXX" onChange={(e) => set({ ga: e.target.value })} />
          </label>
          {!!s.ga && !/^[A-Za-z0-9-]*$/.test(s.ga) && <div className="nc-site-hint bad">{t('lp.page.use_letters_and_numbers_only', 'Use letters and numbers only')}</div>}
        </Section>
      </div>
    </div>
  );
}

/** "Embed this page": an iframe snippet of the public page in embed mode. */
export function embedCode(url: string): string {
  return `<iframe src="${url}${url.includes('?') ? '&' : '?'}embed=1" width="100%" height="600" frameborder="0" allowfullscreen></iframe>`;
}

export function openEmbedCode(anchor: HTMLElement, url: string) {
  const code = embedCode(url);
  openOverlay((close) => (
    <div className="nc-popover nc-embed-code" role="dialog" aria-label={t('lp.page.embed_page', 'Embed page')}>
      <div className="nc-embed-code-title">{t('lp.page.embed_page', 'Embed page')}</div>
      <div className="nc-site-hint">{t('lp.page.put_this_page_on_external_websites', 'Put this page on external websites as an embed')}</div>
      <textarea readOnly value={code} rows={3} onFocus={(e) => e.currentTarget.select()} />
      <div className="nc-embed-code-actions">
        <button type="button" className="nc-dialog-btn primary" onClick={() => { void navigator.clipboard?.writeText(code); useUI.getState().toast(t('lp.page.copied_embed_code', 'Copied embed code')); close(); }}>
          {t('lp.page.copy_code', 'Copy code')}
        </button>
      </div>
    </div>
  ), { anchor, placement: 'bottom-end', offset: 4 });
}

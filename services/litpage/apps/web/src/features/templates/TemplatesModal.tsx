// Templates gallery modal (useUI templatesOpen — Home "Featured templates", Apps menu, page "Templates" chip):
// left: search + Suggested / Work / Life / School categories with their templates; right: header with the
// selected template's name, description and "Use template", above a live read-only preview of the template.
import { useEffect, useMemo, useState } from 'react';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import { Modal } from '../../components/Modal.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useUI } from '../../lib/store/ui.ts';
import { getLocation, navigate, spaceDomain } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { addTemplate, applyTemplate, categoryLabel, CATEGORY_ORDER, useTemplates, type TemplateCategory, type TemplateInfo } from './api.ts';
import { TemplatePreview } from './TemplatePreview.tsx';
import { CATEGORY_ICON } from './MarketplacePage.tsx';
import './icons.tsx';
import './templates.css';

type Group = 'suggested' | TemplateCategory;

const plain = (rt: unknown) => (Array.isArray(rt) ? (rt as [string][]).map((d) => d[0]).join('') : '');

/** The page the modal was opened from, when a template can be applied to it (editable, not a database row, still empty). */
function blankCurrentPage(): string | undefined {
  const { route } = getLocation();
  if (route.name !== 'page') return undefined;
  const b = records.get<BlockRecord>('block', route.pageId);
  if (!b || b.type !== 'page' || b.parent_table === 'collection' || !roleAtLeast(records.role('block', b.id), 'read_and_write')) return undefined;
  const blank = (b.content ?? []).every((id) => {
    const c = records.get<BlockRecord>('block', id);
    return !c || c.alive === false || (c.type === 'text' && !plain(c.properties?.title));
  });
  return blank ? b.id : undefined;
}

export function TemplatesModal() {
  const close = () => useUI.getState().set({ templatesOpen: false });
  const { templates, loading } = useTemplates();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Group, boolean>>({ suggested: true, work: true, life: false, school: false });
  const [busy, setBusy] = useState(false);
  const [blankPageId] = useState(blankCurrentPage);
  const domain = spaceDomain(useSession((s) => s.spaceId));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? templates.filter((x) => `${x.name} ${x.description} ${x.tags.join(' ')}`.toLowerCase().includes(s)) : templates;
  }, [templates, q]);
  useEffect(() => {
    if (!selected && templates.length) setSelected((templates.find((x) => x.featured) ?? templates[0]).id);
  }, [templates, selected]);
  const tpl = templates.find((x) => x.id === selected);

  const groups: { id: Group; label: string; items: TemplateInfo[] }[] = q.trim()
    ? [{ id: 'suggested', label: t('lp.templates.results', 'Results'), items: filtered }]
    : [
        { id: 'suggested', label: t('lp.templates.suggested', 'Suggested'), items: templates.filter((x) => x.featured) },
        ...CATEGORY_ORDER.map((c) => ({ id: c as Group, label: categoryLabel(c), items: templates.filter((x) => x.category === c) })).filter((g) => g.items.length),
      ];

  const use = async () => {
    if (!tpl) return;
    setBusy(true);
    try {
      if (blankPageId) await applyTemplate(tpl.id, blankPageId);
      else await addTemplate(tpl.id);
      close();
    } catch (e) {
      useUI.getState().toast((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={close} width="min(1120px, calc(100vw - 48px))" height="min(760px, calc(100vh - 72px))" top="max(36px, 5vh)" className="nc-tmodal">
      <div className="nc-tmodal-layout" role="dialog" aria-label={t('lp.templates.templates', 'Templates')}>
        <aside className="nc-tmodal-side">
          <div className="nc-tmodal-side-head">{t('lp.templates.templates', 'Templates')}</div>
          <div className="nc-tmodal-search nc-input">
            <Icon name="magnifyingGlass" size={16} style={{ color: 'var(--lp-icon-secondary)', marginRight: 6 }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lp.templates.search_templates', 'Search templates')} />
          </div>
          <div className="nc-tmodal-groups lit-scroller vertical">
            {loading && <div className="nc-tmodal-empty">…</div>}
            {groups.map((g) => {
              const expanded = q.trim() ? true : open[g.id];
              return (
                <div key={g.id} className="nc-tmodal-group">
                  <div role="button" className="nc-tmodal-group-head" aria-expanded={expanded} onClick={() => setOpen({ ...open, [g.id]: !open[g.id] })}>
                    <Icon name="arrowChevronSingleDownFillSmall" size={12} style={{ transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms', color: 'var(--lp-icon-tertiary)' }} />
                    {g.id !== 'suggested' && <Icon name={CATEGORY_ICON[g.id].icon} size={16} style={{ color: CATEGORY_ICON[g.id].color }} />}
                    <span>{g.label}</span>
                  </div>
                  {expanded && g.items.map((x) => (
                    <div
                      key={`${g.id}-${x.id}`}
                      role="option"
                      aria-selected={x.id === selected}
                      className={`nc-tmodal-item ${x.id === selected ? 'selected' : ''}`}
                      onClick={() => setSelected(x.id)}
                      onDoubleClick={() => void use()}
                    >
                      <span className="nc-tmodal-item-icon">{x.icon}</span>
                      <span className="nc-ellipsis">{x.name}</span>
                    </div>
                  ))}
                  {expanded && !g.items.length && <div className="nc-tmodal-empty">{t('lp.templates.no_templates_match_your_search', 'No templates match your search')}</div>}
                </div>
              );
            })}
          </div>
          <div
            role="button"
            className="nc-tmodal-more"
            onClick={() => {
              close();
              navigate(`/${domain}/marketplace/templates`);
            }}
          >
            <Icon name="marketplaceMark" size={18} />
            {t('lp.templates.browse_more_in_marketplace', 'Browse more in Marketplace')}
          </div>
        </aside>
        <section className="nc-tmodal-main">
          {tpl ? (
            <>
              <header className="nc-tmodal-head">
                <div className="nc-tmodal-head-text">
                  <div className="nc-tmodal-head-title"><span>{tpl.icon}</span>{tpl.name}</div>
                  <div className="nc-tmodal-head-desc">{tpl.description}</div>
                </div>
                <button className="nc-btn primary nc-tmodal-use" disabled={busy} onClick={() => void use()} data-testid="use-template">
                  {t('lp.templates.use_template', 'Use template')}
                </button>
                <div role="button" className="nc-btn icon-only" aria-label={t('lp.templates.close', 'Close')} onClick={close}>
                  <Icon name="close" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
                </div>
              </header>
              <TemplatePreview tpl={tpl} className="in-modal" />
            </>
          ) : (
            <div className="nc-tmodal-empty center">{loading ? '' : t('lp.templates.no_templates_match_your_search', 'No templates match your search')}</div>
          )}
        </section>
      </div>
    </Modal>
  );
}

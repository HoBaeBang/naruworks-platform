// Marketplace full page (/<domain>/marketplace[/<tab>[/<templateId>]]): Discover / Templates / Agents /

// marketplace grid: content ≤1248px, side margins ≥96px; 24px/600 tab words; 300px hero cards radius 16) and



import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate, spaceDomain, useLocation } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useCurrentSpace } from '../../lib/hooks.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { t } from '../shell/i18n.ts';
import { addTemplate, categoryLabel, CATEGORY_ORDER, sectionTitle, useTemplates, type TemplateCategory, type TemplateInfo } from './api.ts';
import { TemplateThumb } from './TemplateThumb.tsx';
import { TemplatePreview } from './TemplatePreview.tsx';
import { openCreatorDialog, openPurchased } from './Purchased.tsx';
import { ReviewsSection, Stars } from './Reviews.tsx';
import './icons.tsx';
import './templates.css';

/** set by the topbar "Search" button: focus the template search once the Templates tab mounts */
let focusSearchNext = false;

type Tab = 'discover' | 'templates' | 'agents' | 'consultants' | 'skills' | 'connections';
const TABS: Tab[] = ['discover', 'templates', 'agents', 'consultants', 'skills', 'connections'];

function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'discover':
      return t('lp.templates.discover', 'Discover');
    case 'templates':
      return t('lp.templates.templates', 'Templates');
    case 'agents':
      return t('lp.templates.agents', 'Agents');
    case 'consultants':
      return t('lp.templates.consultants', 'Consultants');
    case 'skills':
      return t('lp.templates.skills', 'Skills');
    case 'connections':
      return t('lp.templates.connections', 'Connections');
  }
}

export const CATEGORY_ICON: Record<TemplateCategory, { icon: string; color: string; bg: string }> = {
  work: { icon: 'briefcase', color: 'var(--lp-blue-icon-accent)', bg: 'var(--lp-blue-bg-primary)' },
  life: { icon: 'leaf', color: 'var(--lp-yellow-icon-accent)', bg: 'var(--lp-yellow-bg-primary)' },
  school: { icon: 'graduationCap', color: 'var(--lp-red-icon-accent)', bg: 'var(--lp-red-bg-primary)' },
};

function templateIdFromPath(): string | null {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts[1] === 'marketplace' && parts[2] === 'templates' && parts[3] ? decodeURIComponent(parts[3]) : null;
}

export function MarketplacePage({ tab }: { tab?: string }) {
  useLocation();
  const domain = spaceDomain(useSession((s) => s.spaceId));
  const active: Tab = (TABS as string[]).includes(tab ?? '') ? (tab as Tab) : 'discover';
  const detailId = templateIdFromPath();
  const { templates, loading, error } = useTemplates();
  const go = (p: string) => navigate(`/${domain}/marketplace${p}`);
  const openTemplate = (id: string) => go(`/templates/${encodeURIComponent(id)}`);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [active, detailId]);
  const detail = detailId ? templates.find((x) => x.id === detailId) : undefined;
  // topbar buttons (parent Topbar): Search / My profile / Purchased
  useEffect(() => {
    const on = (e: Event) => {
      const action = (e as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'search') {
        focusSearchNext = true;
        if (active !== 'templates' || detailId) go('/templates');
        else window.dispatchEvent(new Event('nc:marketplace-focus-search'));
      } else if (action === 'checkmarkSquare') openPurchased(openTemplate);
      else if (action) useUI.getState().toast(t('lp.templates.not_available_in_this_build', 'Not available in this build'));
    };
    window.addEventListener('nc:marketplace-action', on);
    return () => window.removeEventListener('nc:marketplace-action', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, detailId, domain]);
  return (
    <div ref={scroller} className="lit-scroller vertical nc-mkt-scroller" data-testid="marketplace">
      <div className="layout layout-marketplace nc-mkt-layout">
        <div className="layout-content nc-mkt-content">
          {detailId ? (
            detail ? (
              <TemplateDetail tpl={detail} all={templates} onBack={() => go('/templates')} onOpen={openTemplate} />
            ) : loading ? null : (
              <div className="nc-mkt-empty">{t('lp.templates.this_template_isn_t_available', 'This template isn’t available.')}</div>
            )
          ) : (
            <>
              <nav className="nc-mkt-tabs" role="tablist">
                {TABS.map((x) => (
                  <a
                    key={x}
                    role="tab"
                    aria-selected={x === active}
                    href={`/${domain}/marketplace${x === 'discover' ? '' : `/${x}`}`}
                    className={`nc-mkt-tab ${x === active ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      go(x === 'discover' ? '' : `/${x}`);
                    }}
                  >
                    {tabLabel(x)}
                  </a>
                ))}
              </nav>
              {error && <div className="nc-mkt-empty">{error}</div>}
              {active === 'discover' && <Discover templates={templates} onOpen={openTemplate} onTab={(x) => go(`/${x}`)} />}
              {active === 'templates' && <TemplatesTab templates={templates} onOpen={openTemplate} />}
              {(active === 'agents' || active === 'consultants' || active === 'skills' || active === 'connections') && <SimpleListing kind={active} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Discover

function Discover({ templates, onOpen, onTab }: { templates: TemplateInfo[]; onOpen: (id: string) => void; onTab: (tab: Tab) => void }) {
  const featured = templates.filter((x) => x.featured);
  const meeting = templates.find((x) => x.id === 'meeting-notes');
  return (
    <div className="nc-mkt-stack">
      <section className="nc-mkt-hero white">
        <div className="nc-mkt-hero-text">
          <div className="nc-mkt-hero-label"><Icon name="chatUser" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />{t('lp.templates.consulting', 'Consulting')}</div>
          <div className="nc-mkt-hero-title">{t('lp.templates.get_a_free_setup_session', 'Get a free setup session')}</div>
          <div className="nc-mkt-hero-desc">{t('lp.templates.certified_litpage_consultants_offer_limi', 'Certified Litpage consultants offer limited 30-minute sessions. Get help before the spots are gone.')}</div>
          <div role="button" className="nc-mkt-dark-btn" onClick={() => onTab('consultants')}>{t('lp.templates.reserve_now', 'Reserve now')}</div>
        </div>
        <div className="nc-mkt-hero-art">
          <ThumbStack items={featured.slice(0, 3)} />
        </div>
      </section>
      <section className="nc-mkt-row3">
        {meeting && (
          <a
            href="#"
            className="nc-mkt-hero blue span2"
            onClick={(e) => {
              e.preventDefault();
              onOpen(meeting.id);
            }}
          >
            <div className="nc-mkt-hero-text">
              <div className="nc-mkt-hero-label"><Icon name="peopleMeeting" size={16} style={{ color: 'var(--lp-blue-icon-accent)' }} />{t('lp.templates.meetings', 'Meetings')}</div>
              <div className="nc-mkt-hero-title">{t('lp.templates.more_than_meeting_notes', 'More than meeting notes')}</div>
              <div className="nc-mkt-hero-desc">{t('lp.templates.for_everything_that_happens_before_durin', 'For everything that happens before, during, and after a meeting.')}</div>
              <div className="nc-mkt-explore">{t('lp.templates.explore', 'Explore')}<Icon name="arrowStraightRight" size={16} /></div>
            </div>
            <div className="nc-mkt-hero-art right"><TemplateThumb tpl={meeting} size="md" /></div>
          </a>
        )}
        <a
          href="#"
          className="nc-mkt-hero white"
          onClick={(e) => {
            e.preventDefault();
            onTab('templates');
          }}
        >
          <div className="nc-mkt-hero-text">
            <div className="nc-mkt-hero-label"><Icon name="medal" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />{t('lp.templates.top_creator', 'Top creator')}</div>
            <div className="nc-mkt-hero-title">Litpage</div>
            <div className="nc-mkt-hero-desc">{t('lp.templates.starter_templates_for_projects_notes_pla', 'Starter templates for projects, notes, planning and more — free for every workspace.')}</div>
            <div className="nc-mkt-explore bottom">
              <span>{t('lp.templates.explore', 'Explore')}<Icon name="arrowStraightRight" size={16} /></span>
              <div className="nc-mkt-avatar"><Icon name="marketplaceMark" size={64} /></div>
            </div>
          </div>
        </a>
      </section>
      <CarouselSection title={t('lp.templates.featured_templates', 'Featured templates')} icon="squareGrid2X2Small" items={featured} onOpen={onOpen} onBrowse={() => onTab('templates')} />
      {CATEGORY_ORDER.filter((c) => templates.some((x) => x.category === c)).map((c) => (
        <CarouselSection key={c} title={sectionTitle(c)} icon={CATEGORY_ICON[c].icon} items={templates.filter((x) => x.category === c)} onOpen={onOpen} onBrowse={() => onTab('templates')} />
      ))}
    </div>
  );
}

function ThumbStack({ items }: { items: TemplateInfo[] }) {
  return (
    <div className="nc-mkt-stackart">
      {items.map((x, i) => (
        <div key={x.id} className={`nc-mkt-stackart-item i${i}`}><TemplateThumb tpl={x} size="sm" /></div>
      ))}
    </div>
  );
}

function CarouselSection({ title, icon, items, onOpen, onBrowse }: { title: string; icon: string; items: TemplateInfo[]; onOpen: (id: string) => void; onBrowse: () => void }) {
  if (!items.length) return null;
  return (
    <section className="nc-mkt-carousel-section">
      <div className="nc-mkt-section-head">
        <div className="nc-mkt-section-label"><Icon name={icon} size={16} style={{ color: 'var(--lp-icon-secondary)' }} />{title}</div>
        <a
          role="link"
          className="nc-mkt-browse"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onBrowse();
          }}
        >
          {t('lp.templates.browse_all', 'Browse all')}
        </a>
      </div>
      <div className="nc-mkt-carousel lit-scroller horizontal">
        <div className="nc-mkt-carousel-track">
          {items.map((x) => <SmallCard key={x.id} tpl={x} onOpen={onOpen} />)}
        </div>
      </div>
    </section>
  );
}

function SmallCard({ tpl, onOpen }: { tpl: TemplateInfo; onOpen: (id: string) => void }) {
  return (
    <a
      role="link"
      href="#"
      className="nc-mkt-small-card"
      onClick={(e) => {
        e.preventDefault();
        onOpen(tpl.id);
      }}
    >
      <div className="nc-mkt-small-thumb"><TemplateThumb tpl={tpl} size="sm" /></div>
      <div className="nc-mkt-small-body">
        <div className="nc-mkt-small-title nc-ellipsis">{tpl.name}</div>
        <div className="nc-mkt-small-meta"><span className="nc-ellipsis">{tpl.creator}</span><span className="nc-mkt-free">{t('lp.templates.free', 'Free')}</span></div>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------- Templates tab

function matches(tpl: TemplateInfo, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [tpl.name, tpl.description, ...tpl.tags, categoryLabel(tpl.category)].join(' ').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w) || (w.length > 3 && hay.includes(w.slice(0, -1))));
}

function TemplatesTab({ templates, onOpen }: { templates: TemplateInfo[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCatState] = useState<TemplateCategory | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const setCat = (c: TemplateCategory | null, tag: string | null = null) => {
    setCatState(c);
    setSub(tag);
  };
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    if (focusSearchNext) {
      focusSearchNext = false;
      setTimeout(focus, 0);
    }
    window.addEventListener('nc:marketplace-focus-search', focus);
    return () => window.removeEventListener('nc:marketplace-focus-search', focus);
  }, []);
  const filtered = useMemo(() => templates.filter((x) => (!cat || x.category === cat) && (!sub || x.tags.includes(sub)) && matches(x, q)), [templates, q, cat, sub]);
  const browsing = !!q.trim() || !!cat;
  return (
    <div className="nc-mkt-stack">
      <section className="nc-mkt-tpl-hero">
        <div className="nc-mkt-tpl-hero-text">
          <h1 className="nc-mkt-tpl-title">{t('lp.templates.move_faster_with_templates', 'Move faster with templates')}</h1>
          <label className="nc-mkt-search">
            <Icon name="magnifyingGlass" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('lp.templates.what_kind_of_template_are_you', 'What kind of template are you looking for?')}
              aria-label={t('lp.templates.what_kind_of_template_are_you', 'What kind of template are you looking for?')}
            />
            {q && <span role="button" className="nc-mkt-search-clear" onClick={() => setQ('')}><Icon name="xSmall" size={14} /></span>}
          </label>
          <div className="nc-mkt-chips">
            {CATEGORY_ORDER.filter((c) => templates.some((x) => x.category === c)).map((c) => (
              <div
                key={c}
                role="button"
                aria-pressed={cat === c}
                className={`nc-mkt-chip ${cat === c ? 'selected' : ''}`}
                style={{ background: CATEGORY_ICON[c].bg }}
                onClick={() => setCat(cat === c ? null : c)}
              >
                <Icon name={CATEGORY_ICON[c].icon} size={20} style={{ color: CATEGORY_ICON[c].color }} />
                {categoryLabel(c)}
              </div>
            ))}
            <div
              role="button"
              aria-haspopup="menu"
              className="nc-mkt-chip nc-mkt-cat-dropdown"
              onClick={(e) => openCategoriesMenu(e.currentTarget, templates, (c, tag) => setCat(c, tag))}
            >
              {t('lp.templates.categories', 'Categories')}
              <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          </div>
        </div>
        <div className="nc-mkt-tpl-hero-art"><ThumbStack items={templates.filter((x) => x.featured).slice(0, 3)} /></div>
      </section>
      {browsing ? (
        <section>
          <div className="nc-mkt-h2row">
            <h2 className="nc-mkt-h2">
              {cat ? categoryLabel(cat) : t('lp.templates.all_templates', 'All templates')}
              {sub && <span className="nc-mkt-subcat"> › {sub}</span>}
            </h2>
            <span className="nc-mkt-count">{filtered.length}</span>
          </div>
          {filtered.length ? <Grid items={filtered} onOpen={onOpen} /> : <div className="nc-mkt-empty">{t('lp.templates.no_templates_match_your_search', 'No templates match your search')}</div>}
        </section>
      ) : (
        <>
          {CATEGORY_ORDER.map((c) => {
            const items = templates.filter((x) => x.category === c);
            if (!items.length) return null;
            return (
              <section key={c}>
                <div className="nc-mkt-h2row">
                  <h2 className="nc-mkt-h2">{sectionTitle(c)}</h2>
                  <a
                    href="#"
                    className="nc-mkt-seeall"
                    onClick={(e) => {
                      e.preventDefault();
                      setCat(c);
                    }}
                  >
                    {t('lp.templates.see_all', 'See all')}
                  </a>
                </div>
                <div className="nc-mkt-feature-row">
                  {items.slice(0, 2).map((x) => <FeatureCard key={x.id} tpl={x} onOpen={onOpen} />)}
                </div>
              </section>
            );
          })}
          <section>
            <div className="nc-mkt-h2row">
              <h2 className="nc-mkt-h2">{t('lp.templates.all_templates', 'All templates')}</h2>
            </div>
            <Grid items={templates} onOpen={onOpen} />
          </section>
        </>
      )}
    </div>
  );
}

/** "Categories" dropdown: each category with its subcategories (template tags) and "View all". */
function openCategoriesMenu(anchor: HTMLElement, templates: TemplateInfo[], pick: (c: TemplateCategory, tag: string | null) => void) {
  openMenu(anchor, {
    width: 260,
    maxHeight: '60vh',
    sections: CATEGORY_ORDER.filter((c) => templates.some((x) => x.category === c)).map((c) => {
      const tags = [...new Set(templates.filter((x) => x.category === c).flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b));
      return {
        title: categoryLabel(c),
        items: [
          { label: t('lp.templates.view_all', 'View all'), icon: CATEGORY_ICON[c].icon, iconColor: CATEGORY_ICON[c].color, onSelect: () => pick(c, null) },
          ...tags.map((tag) => ({ label: tag, right: <span className="nc-mkt-count">{templates.filter((x) => x.category === c && x.tags.includes(tag)).length}</span>, onSelect: () => pick(c, tag) })),
        ],
      };
    }),
  }, { placement: 'bottom-start' });
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
}


function CardMeta({ tpl }: { tpl: TemplateInfo }) {
  return (
    <div className="nc-mkt-grid-meta">
      {tpl.rating != null && tpl.reviews ? (
        <span className="nc-mkt-card-rating" aria-label={t('lp.templates.5_star_rating', '{rating}/5 star rating', { rating: tpl.rating.toFixed(1) })}>
          <Icon name="starFillSmall" size={13} style={{ color: 'var(--lp-icon-secondary)', fill: 'var(--lp-icon-secondary)' }} />
          {tpl.rating.toFixed(1)} ({tpl.reviews}) ·{' '}
        </span>
      ) : null}
      <span className="nc-ellipsis">{tpl.creator}</span>
      {tpl.adds ? <span className="nc-mkt-card-adds"> · {t('lp.templates.count_plural_one_other', '{count, plural, one {# download} other {# downloads}}', { count: tpl.adds })}</span> : null}
    </div>
  );
}

function FeatureCard({ tpl, onOpen }: { tpl: TemplateInfo; onOpen: (id: string) => void }) {
  const c = CATEGORY_ICON[tpl.category];
  return (
    <a
      href="#"
      className={`nc-mkt-feature ${tpl.category}`}
      onClick={(e) => {
        e.preventDefault();
        onOpen(tpl.id);
      }}
    >
      <div className="nc-mkt-feature-text">
        <div className="nc-mkt-feature-label"><Icon name={c.icon} size={16} style={{ color: c.color }} />{tpl.tags[0] ?? categoryLabel(tpl.category)}</div>
        <div className="nc-mkt-feature-title">{tpl.name}</div>
        <div className="nc-mkt-feature-desc">{tpl.description}</div>
      </div>
      <div className="nc-mkt-feature-art"><TemplateThumb tpl={tpl} size="sm" /></div>
    </a>
  );
}

function Grid({ items, onOpen }: { items: TemplateInfo[]; onOpen: (id: string) => void }) {
  return (
    <div className="nc-mkt-grid">
      {items.map((x) => (
        <a
          key={x.id}
          href="#"
          className="nc-mkt-grid-card"
          data-template-id={x.id}
          onClick={(e) => {
            e.preventDefault();
            onOpen(x.id);
          }}
        >
          <div className="nc-mkt-grid-thumb"><TemplateThumb tpl={x} size="md" /></div>
          <div className="nc-mkt-grid-info">
            <span className="nc-mkt-grid-avatar">{x.icon}</span>
            <span className="nc-mkt-grid-title nc-ellipsis">{x.name}</span>
            <span className="nc-mkt-price">{t('lp.templates.free', 'Free')}</span>
          </div>
          <CardMeta tpl={x} />
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- template detail

function TemplateDetail({ tpl, all, onBack, onOpen }: { tpl: TemplateInfo; all: TemplateInfo[]; onBack: () => void; onOpen: (id: string) => void }) {
  const space = useCurrentSpace();
  const [busy, setBusy] = useState(false);
  const more = all.filter((x) => x.id !== tpl.id && x.category === tpl.category).slice(0, 3);
  const add = async () => {
    setBusy(true);
    try {
      await addTemplate(tpl.id);
    } catch (e) {
      useUI.getState().toast((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="nc-mkt-detail">
      <a
        href="#"
        className="nc-mkt-back"
        onClick={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        <Icon name="arrowLeftSmall" size={16} />
        {t('lp.templates.all_templates', 'All templates')}
      </a>
      <header className="nc-mkt-detail-head">
        <div className="nc-mkt-detail-icon">{tpl.icon}</div>
        <div className="nc-mkt-detail-main">
          <h1 className="nc-mkt-detail-title">{tpl.name}</h1>
          <div className="nc-mkt-detail-creator">
            <span className="nc-mkt-detail-avatar"><Icon name="marketplaceMark" size={16} /></span>
            <span role="button" className="nc-mkt-creator-link" onClick={() => openCreatorDialog(tpl.creator, all, onOpen)}>{tpl.creator}</span>
            <span className="nc-mkt-dot">·</span>
            <span>{categoryLabel(tpl.category)}</span>
            <span className="nc-mkt-dot">·</span>
            <span className="nc-mkt-free">{t('lp.templates.free', 'Free')}</span>
          </div>
          <p className="nc-mkt-detail-desc">{tpl.description}</p>
          <div className="nc-mkt-detail-actions">
            <button className="nc-btn primary nc-mkt-add" disabled={busy} onClick={() => void add()} data-testid="add-template">
              {t('lp.templates.add_to', 'Add to {workspaceName}', { workspaceName: space?.name ?? 'workspace' })}
            </button>
            <button
              className="nc-btn outline nc-mkt-preview-btn"
              onClick={() => document.querySelector('.nc-mkt-detail-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <Icon name="eyeOpen" size={16} />
              {t('lp.templates.preview', 'Preview')}
            </button>
          </div>
          <div className="nc-mkt-tags">{tpl.tags.map((x) => <span key={x} className="nc-mkt-tag">{x}</span>)}</div>
        </div>
      </header>
      <DetailStats tpl={tpl} all={all} />
      <div className="nc-mkt-detail-preview">
        <TemplatePreview tpl={tpl} />
      </div>
      <ReviewsSection tpl={tpl} />
      {more.length > 0 && (
        <section>
          <div className="nc-mkt-h2row"><h2 className="nc-mkt-h2">{t('lp.templates.similar_templates', 'Similar templates')}</h2></div>
          <Grid items={more} onOpen={onOpen} />
        </section>
      )}
    </div>
  );
}

function agoWords(ms: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  if (d < 1) return t('lp.templates.today', 'today');
  const unit = d >= 365 ? [Math.floor(d / 365), 'year'] : d >= 30 ? [Math.floor(d / 30), 'month'] : d >= 7 ? [Math.floor(d / 7), 'week'] : [d, 'day'];
  return `${unit[0]} ${unit[1]}${unit[0] === 1 ? '' : 's'}`;
}

/** Template page stat row: rating, downloads, ranking in its category, version update. */
function DetailStats({ tpl, all }: { tpl: TemplateInfo; all: TemplateInfo[] }) {
  const peers = all.filter((x) => x.category === tpl.category).sort((a, b) => (b.adds ?? 0) - (a.adds ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));
  const rank = peers.findIndex((x) => x.id === tpl.id) + 1;
  const stats: { title: ReactNode; sub: string; id: string }[] = [];
  if (tpl.rating != null && tpl.reviews) {
    stats.push({
      id: 'rating',
      title: <><span>{t('lp.templates.text', '{averageRating, number, ::.0}', { averageRating: tpl.rating.toFixed(1) })}</span><Stars value={tpl.rating} size={13} /></>,
      sub: t('lp.templates.ratingcount_plural_one_rating_other_rati', '{ratingCount, plural, one {{ratingCount} review} other {{ratingCount} reviews}}', { ratingCount: tpl.reviews }),
    });
  }
  stats.push({ id: 'downloads', title: compact(tpl.adds ?? 0), sub: t('lp.templates.downloads', 'Downloads') });
  if (rank > 0 && (tpl.adds ?? 0) > 0) stats.push({ id: 'ranking', title: t('lp.templates.in', '#{ranking} in {categoryName}', { ranking: rank, categoryName: categoryLabel(tpl.category) }), sub: t('lp.templates.ranking', 'Ranking') });
  if (tpl.updatedTime) stats.push({ id: 'updated', title: t('lp.templates.ago', '{messageOfTimestampMs} ago', { messageOfTimestampMs: agoWords(tpl.updatedTime) }), sub: t('lp.templates.version_update', 'Version update') });
  return (
    <div className="nc-mkt-stats" data-testid="template-stats">
      {stats.map((x) => (
        <div key={x.id} className="nc-mkt-stat" data-stat={x.id}>
          <div className="v">{x.title}</div>
          <div className="l">{x.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- other tabs (static listings)

const LISTINGS: Record<'agents' | 'consultants' | 'skills' | 'connections', { title: string; desc: string; items: { icon: string; name: string; desc: string }[] }> = {
  agents: {
    title: 'Agents', desc: 'Custom agents that work for your team in Litpage.',
    items: [
      { icon: '🗂️', name: 'Inbox triage', desc: 'Sorts incoming requests into the right database.' },
      { icon: '📝', name: 'Meeting summarizer', desc: 'Turns meeting notes into decisions and action items.' },
      { icon: '📈', name: 'Weekly reporter', desc: 'Writes a weekly status update from your project tracker.' },
    ],
  },
  consultants: {
    title: 'Consultants', desc: 'Certified experts who can help you set up Litpage.',
    items: [
      { icon: '🧭', name: 'Workspace setup', desc: 'A guided session to structure teamspaces and permissions.' },
      { icon: '🛠️', name: 'Database design', desc: 'Model projects, tasks and relations for your team.' },
      { icon: '🎓', name: 'Team training', desc: 'Onboard your team with live workshops.' },
    ],
  },
  skills: {
    title: 'Skills', desc: 'Reusable instructions for Litpage AI.',
    items: [
      { icon: '✍️', name: 'Write a project brief', desc: 'Drafts a brief from a few bullet points.' },
      { icon: '🔎', name: 'Research summary', desc: 'Summarizes sources into key findings.' },
      { icon: '🌐', name: 'Translate page', desc: 'Translates a page while keeping formatting.' },
    ],
  },
  connections: {
    title: 'Connections', desc: 'Connect apps to search, sync and take actions from Litpage.',
    items: [
      { icon: '💬', name: 'Chat apps', desc: 'Share pages and get notifications in your chat tools.' },
      { icon: '📁', name: 'File storage', desc: 'Embed and search files from cloud drives.' },
      { icon: '🐙', name: 'Code hosting', desc: 'Link pull requests and issues to pages.' },
    ],
  },
};

function SimpleListing({ kind }: { kind: 'agents' | 'consultants' | 'skills' | 'connections' }) {
  const l = LISTINGS[kind];
  return (
    <div className="nc-mkt-stack">
      <section>
        <div className="nc-mkt-h2row"><h2 className="nc-mkt-h2">{tabLabel(kind)}</h2></div>
        <p className="nc-mkt-listing-desc">{l.desc}</p>
        <div className="nc-mkt-listing">
          {l.items.map((x) => (
            <div key={x.name} role="button" className="nc-mkt-listing-card" onClick={() => useUI.getState().toast(t('lp.templates.not_available_in_this_build', 'Not available in this build'))}>
              <div className="nc-mkt-listing-icon">{x.icon}</div>
              <div className="nc-mkt-listing-name">{x.name}</div>
              <div className="nc-mkt-listing-text">{x.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

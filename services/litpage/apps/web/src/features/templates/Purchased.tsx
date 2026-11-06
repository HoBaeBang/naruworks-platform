
// Purchased templates show creator, purchaser, price, and transaction date, with actions to view, add again, or review
// templates. Built-in catalog templates carry no external contact details, so nothing leaves the workspace.
import { useEffect, useState } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openPage } from '../../lib/router.ts';
import { formatShortDate } from '../../lib/format.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import { addTemplate, categoryLabel, loadAddedTemplates, loadTemplates, type AddedTemplate, type TemplateCategory, type TemplateInfo } from './api.ts';
import { openReviewDialog } from './Reviews.tsx';

function Purchased({ close, onOpenTemplate }: { close: () => void; onOpenTemplate: (id: string) => void }) {
  const [rows, setRows] = useState<AddedTemplate[] | null>(null);
  const [catalog, setCatalog] = useState<TemplateInfo[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void Promise.all([loadAddedTemplates(), loadTemplates()]).then(([added, all]) => {
      if (!alive) return;
      setCatalog(all);
      setRows(added);
    }).catch((e) => {
      useUI.getState().toast((e as Error).message);
      if (alive) setRows([]);
    });
    return () => {
      alive = false;
    };
  }, [version]);
  const me = records.get<UserRecord>('lit_user', useSession.getState().userId ?? '');
  // the menu closes every overlay after a pick unless onSelect returns false: close just the menu, keep this dialog
  const actions = (anchor: HTMLElement, row: AddedTemplate, tpl: TemplateInfo) => {
    let closeMenu = () => {};
    const keep = (fn: () => void) => () => {
      closeMenu();
      fn();
      return false;
    };
    closeMenu = openMenu(anchor, {
      sections: [{
        items: [
          { label: t('lp.templates.see_it_in_the_template_gallery', 'See it in the template gallery'), icon: 'squareGrid2X2Small', onSelect: keep(() => { close(); onOpenTemplate(tpl.id); }) },
          ...(row.pageId ? [{ label: t('lp.templates.open_in_workspace', 'Open in workspace'), icon: 'arrowStraightRight', onSelect: keep(() => { close(); openPage(row.pageId!); }) }] : []),
          { label: t('lp.templates.add_again', 'Add again'), icon: 'duplicate', onSelect: keep(() => { close(); void addTemplate(tpl.id).catch((e) => useUI.getState().toast((e as Error).message)); }) },
          row.myRating
            ? { label: t('lp.templates.review_submitted', 'Review submitted'), icon: 'starFillSmall', disabled: true }
            : { label: t('lp.templates.write_a_review', 'Write a review'), icon: 'starFillSmall', onSelect: keep(() => openReviewDialog(tpl, () => setVersion((v) => v + 1))) },
          { label: t('lp.templates.contact_creator', 'Contact creator'), icon: 'chatUser', onSelect: keep(() => openCreatorDialog(tpl.creator, catalog, (id) => { close(); onOpenTemplate(id); })) },
        ],
      }],
    }, { placement: 'bottom-end' });
  };
  return (
    <div className="nc-mkt-buyer" role="dialog" aria-label={t('lp.templates.buyer_profile', 'Buyer profile')} data-testid="marketplace-purchased">
      <div className="nc-mkt-buyer-head">
        <div className="nc-mkt-buyer-title">{t('lp.templates.purchased', 'Purchased')}</div>
        <span role="button" className="nc-mkt-buyer-close" aria-label={t('lp.templates.close', 'Close')} onClick={close}><Icon name="xSmall" size={16} /></span>
      </div>
      {rows === null ? (
        <div className="nc-mkt-buyer-empty"><Icon name="loader" size={18} /></div>
      ) : rows.length === 0 ? (
        <div className="nc-mkt-buyer-empty">
          <div className="h">{t('lp.templates.no_products', 'No products')}</div>
          <div className="s">{t('lp.templates.templates_bought_from_the_gallery_will', 'Templates bought from the gallery will show up here')}</div>
        </div>
      ) : (
        <div className="nc-mkt-buyer-table" role="table">
          <div className="tr th" role="row">
            <span role="columnheader">{t('lp.templates.product', 'Product')}</span>
            <span role="columnheader">{t('lp.templates.created_by', 'Created by')}</span>
            <span role="columnheader">{t('lp.templates.added_by', 'Added by')}</span>
            <span role="columnheader">{t('lp.templates.price', 'Price')}</span>
            <span role="columnheader">{t('lp.templates.transaction_date', 'Transaction date')}</span>
            <span />
          </div>
          {rows.map((row) => {
            const tpl = catalog.find((x) => x.id === row.templateId);
            if (!tpl) {
              return (
                <div key={row.templateId} className="tr" role="row">
                  <span className="product muted">{t('lp.templates.deleted_template', 'Deleted template')}</span>
                  <span /><span /><span /><span>{formatShortDate(row.time)}</span><span />
                </div>
              );
            }
            return (
              <div key={row.templateId} className="tr" role="row" data-template-id={tpl.id}>
                <span className="product" role="cell">
                  <span className="icon">{tpl.icon}</span>
                  <span className="nc-ellipsis">{tpl.name}</span>
                  {row.myRating ? <span className="mine" aria-label={t('lp.templates.your_rating', 'Your rating')}><Icon name="starFillSmall" size={12} />{row.myRating}</span> : null}
                </span>
                <span role="cell" className="nc-ellipsis">{tpl.creator}</span>
                <span role="cell" className="nc-ellipsis">{me?.name ?? ''}</span>
                <span role="cell">{t('lp.templates.free', 'Free')}</span>
                <span role="cell">{formatShortDate(row.time)}</span>
                <span
                  role="button"
                  className="more"
                  aria-label={t('lp.templates.open_actions_menu', 'Open actions menu')}
                  onClick={(e) => actions(e.currentTarget, row, tpl)}
                >
                  <Icon name="ellipsis" size={16} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function openPurchased(onOpenTemplate: (id: string) => void) {
  openOverlay((close) => <Purchased close={close} onOpenTemplate={onOpenTemplate} />, { placement: 'center', backdrop: 'dim' });
}

function CreatorDialog({ creator, templates, close, onOpenTemplate }: { creator: string; templates: TemplateInfo[]; close: () => void; onOpenTemplate: (id: string) => void }) {
  const mine = templates.filter((x) => x.creator === creator);
  const cats = [...new Set(mine.map((x) => x.category))] as TemplateCategory[];
  const reviews = mine.reduce((s, x) => s + (x.reviews ?? 0), 0);
  return (
    <div className="nc-mkt-creator" role="dialog" aria-label={t('lp.templates.contact_creator', 'Contact creator')} data-testid="marketplace-creator">
      <div className="nc-mkt-creator-head">
        <div className="nc-mkt-creator-avatar"><Icon name="marketplaceMark" size={36} /></div>
        <div>
          <div className="nc-mkt-creator-name">{creator}</div>
          <div className="nc-mkt-creator-meta">
            {t('lp.templates.numberoftemplates_plural_one_template_ot', '{numberOfTemplates, plural, one {{formattedNumberOfTemplates} template} other {{formattedNumberOfTemplates} templates}}', { numberOfTemplates: mine.length, formattedNumberOfTemplates: String(mine.length) })}
            {reviews > 0 && <> · {t('lp.templates.reviews', 'Reviews')} {reviews}</>}
          </div>
        </div>
        <span role="button" className="nc-mkt-buyer-close" aria-label={t('lp.templates.close', 'Close')} onClick={close}><Icon name="xSmall" size={16} /></span>
      </div>
      <div className="nc-mkt-creator-contact">
        <Icon name="chatUser" size={16} />
        {t('lp.templates.this_creator_maintains_the_built_in', 'This creator maintains the built-in template catalog and doesn’t take messages here. For help with a template, open it and use its guide page.')}
      </div>
      {cats.length > 0 && (
        <>
          <div className="nc-mkt-creator-label">{t('lp.templates.top_categories', 'Top categories')}</div>
          <div className="nc-mkt-tags">{cats.map((c) => <span key={c} className="nc-mkt-tag">{categoryLabel(c)}</span>)}</div>
        </>
      )}
      <div className="nc-mkt-creator-label">{t('lp.templates.all_templates', 'All templates')}</div>
      <div className="nc-mkt-creator-list">
        {mine.map((x) => (
          <div key={x.id} role="button" className="row" onClick={() => { close(); onOpenTemplate(x.id); }}>
            <span className="icon">{x.icon}</span>
            <span className="nc-ellipsis">{x.name}</span>
            {x.rating ? <span className="rating"><Icon name="starFillSmall" size={12} />{x.rating.toFixed(1)}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** ••• › Contact creator: the creator's profile (templates, categories) — no outbound contact for catalog creators. */
export function openCreatorDialog(creator: string, templates: TemplateInfo[], onOpenTemplate: (id: string) => void) {
  openOverlay((close) => <CreatorDialog creator={creator} templates={templates} close={close} onOpenTemplate={onOpenTemplate} />, { placement: 'middle', backdrop: 'dim' });
}

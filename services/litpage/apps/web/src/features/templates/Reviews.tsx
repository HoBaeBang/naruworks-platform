
// review dialog (Marketplace › Purchased › ••• › Leave a review, template page), and the template page's
// "Ratings & reviews" section (average, histogram, sortable review list). Only people who added a template can
// review it, once (server: reviewTemplate).
import { useEffect, useState } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { formatShortDate } from '../../lib/format.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import { loadTemplateReviews, submitTemplateReview, type TemplateInfo, type TemplateReview } from './api.ts';

/** Five stars, `value` of them filled (rounded to halves by width). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="nc-mkt-stars" role="img" aria-label={t('lp.templates.5_rating', '{fillRating}/5 rating', { fillRating: value.toFixed(1) })} style={{ height: size }}>
      <span className="row empty">{[0, 1, 2, 3, 4].map((i) => <Icon key={i} name="starFillSmall" size={size} />)}</span>
      <span className="row full" style={{ width: `${pct}%` }}>{[0, 1, 2, 3, 4].map((i) => <Icon key={i} name="starFillSmall" size={size} />)}</span>
    </span>
  );
}

function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="nc-mkt-star-input" role="radiogroup" aria-label={t('lp.templates.review_this_template', 'Review this template')} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={t('lp.templates.rate_star_plural_one_star_other', 'Rate {star, plural, one {{star, number} star} other {{star, number} stars}}', { star: n })}
          className={`star ${n <= shown ? 'on' : ''}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
        >
          <Icon name="starFillSmall" size={28} />
        </span>
      ))}
    </div>
  );
}

function userName(): string {
  const uid = useSession.getState().userId;
  return records.get<UserRecord>('lit_user', uid ?? '')?.name ?? '';
}

function ReviewDialog({ tpl, close, onDone }: { tpl: TemplateInfo; close: () => void; onDone?: () => void }) {
  const [rating, setRating] = useState(0);
  const [step, setStep] = useState<'rate' | 'details'>('rate');
  const [name, setName] = useState(userName);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (details: boolean) => {
    if (!rating) return setError(t('lp.templates.rate_this_template_to_continue', 'Rate this template to continue'));
    setBusy(true);
    try {
      await submitTemplateReview(tpl.id, details ? { rating, name, title, text } : { rating });
      close();
      useUI.getState().toast(t('lp.templates.thanks_for_your_review', 'Thanks for your review'));
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="nc-mkt-review-dialog" role="dialog" aria-label={t('lp.templates.review_this_template', 'Review this template')}>
      {step === 'rate' ? (
        <>
          <div className="nc-mkt-review-icon">{tpl.icon}</div>
          <div className="nc-mkt-review-title">{t('lp.templates.review_this_template', 'Review this template')}</div>
          <div className="nc-mkt-review-sub">{t('lp.templates.how_was_this_template', 'How was this template?')}</div>
          <StarInput value={rating} onChange={(n) => { setRating(n); setError(''); setStep('details'); }} />
          {error && <div className="nc-mkt-review-error">{error}</div>}
          <div className="nc-mkt-review-actions">
            <button className="nc-btn outline" onClick={close}>{t('lp.templates.cancel', 'Cancel')}</button>
            <button className="nc-btn primary" disabled={!rating} onClick={() => setStep('details')}>{t('lp.templates.submit', 'Submit')}</button>
          </div>
        </>
      ) : (
        <>
          <div className="nc-mkt-review-title">{t('lp.templates.tell_us_what_you_think', 'Tell us what you think')}</div>
          <div className="nc-mkt-review-sub">{t('lp.templates.help_the_litpage_community_by_writing', 'Help the Litpage community by writing a review')}</div>
          <StarInput value={rating} onChange={setRating} />
          <label className="nc-mkt-review-field">
            <span>{t('lp.templates.display_name_for_your_review', 'Display name for your review')}</span>
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t('lp.templates.your_name', 'Your name')} />
          </label>
          <label className="nc-mkt-review-field">
            <span>{t('lp.templates.title', 'Title')}</span>
            <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder={t('lp.templates.my_review', 'My review')} />
          </label>
          <label className="nc-mkt-review-field">
            <span>{t('lp.templates.review', 'Review')}</span>
            <textarea value={text} rows={4} maxLength={1500} onChange={(e) => setText(e.target.value)} placeholder={t('lp.templates.template_status', 'Template status…')} />
          </label>
          {error && <div className="nc-mkt-review-error">{error}</div>}
          <div className="nc-mkt-review-actions">
            <button className="nc-btn outline" disabled={busy} onClick={() => void submit(false)}>{t('lp.templates.skip', 'Skip')}</button>
            <button className="nc-btn primary" disabled={busy} onClick={() => void submit(true)}>{t('lp.templates.submit', 'Submit')}</button>
          </div>
        </>
      )}
    </div>
  );
}

/** "Leave a review": rate (1–5 stars), then optional name / title / review text. */
export function openReviewDialog(tpl: TemplateInfo, onDone?: () => void) {
  openOverlay((close) => <ReviewDialog tpl={tpl} close={close} onDone={onDone} />, { placement: 'middle', backdrop: 'dim' });
}

type Sort = 'recent' | 'high' | 'low';

const SORTS: [Sort, () => string][] = [
  ['recent', () => t('lp.templates.most_recent', 'Most Recent')],
  ['high', () => t('lp.templates.highest_first', 'Highest first')],
  ['low', () => t('lp.templates.lowest_first', 'Lowest first')],
];

/** Template page › "Ratings & reviews". */
export function ReviewsSection({ tpl }: { tpl: TemplateInfo }) {
  const [data, setData] = useState<{ reviews: TemplateReview[]; histogram: number[]; mine: TemplateReview | null; canReview: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  const [sort, setSort] = useState<Sort>('recent');
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    let alive = true;
    loadTemplateReviews(tpl.id).then((d) => alive && setData(d)).catch(() => alive && setData({ reviews: [], histogram: [0, 0, 0, 0, 0], mine: null, canReview: false }));
    return () => {
      alive = false;
    };
  }, [tpl.id, version, tpl.added, tpl.reviews]);
  if (!data) return null;
  const n = data.reviews.length;
  const avg = n ? data.reviews.reduce((s, r) => s + r.rating, 0) / n : 0;
  const sorted = [...data.reviews].sort((a, b) => (sort === 'high' ? b.rating - a.rating || b.time - a.time : sort === 'low' ? a.rating - b.rating || b.time - a.time : b.time - a.time));
  const max = Math.max(1, ...data.histogram);
  return (
    <section className="nc-mkt-reviews" data-testid="template-reviews">
      <div className="nc-mkt-h2row">
        <h2 className="nc-mkt-h2">{t('lp.templates.ratings_reviews', 'Ratings & reviews')}</h2>
        {data.canReview && (
          <button className="nc-btn outline nc-mkt-leave-review" onClick={() => openReviewDialog(tpl, () => setVersion((v) => v + 1))}>
            {t('lp.templates.write_a_review', 'Write a review')}
          </button>
        )}
        {data.mine && <span className="nc-mkt-review-done">{t('lp.templates.review_submitted', 'Review submitted')}</span>}
      </div>
      {n === 0 ? (
        <div className="nc-mkt-reviews-empty">
          {tpl.added
            ? t('lp.templates.help_the_community_by_writing_a', 'Help the community by writing a review!')
            : t('lp.templates.no_reviews_yet_people_who_add', 'No reviews yet. People who add this template can rate it.')}
        </div>
      ) : (
        <div className="nc-mkt-reviews-body">
          <div className="nc-mkt-reviews-summary">
            <div className="avg">{avg.toFixed(1)}</div>
            <Stars value={avg} size={16} />
            <div className="based">{t('lp.templates.based_on_ratingcount_plural_one_other', 'Based on {ratingCount, plural, one {# review} other {# reviews}}', { ratingCount: n })}</div>
            <div className="nc-mkt-histogram">
              {[5, 4, 3, 2, 1].map((star) => (
                <div key={star} className="bar-row" aria-label={`${star} star rating, ${data.histogram[star - 1]} reviews`}>
                  <span className="lbl">{star}</span>
                  <span className="bar"><span style={{ width: `${(data.histogram[star - 1] / max) * 100}%` }} /></span>
                  <span className="cnt">{data.histogram[star - 1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="nc-mkt-review-list">
            <div className="nc-mkt-review-list-head">
              <span>{t('lp.templates.all_reviews', 'All reviews')}</span>
              <span
                role="button"
                className="nc-mkt-review-sort"
                aria-label={t('lp.templates.sort_reviews', 'Sort reviews')}
                onClick={(e) => openMenu(e.currentTarget, { sections: [{ items: SORTS.map(([id, label]) => ({ label: label(), checked: sort === id, onSelect: () => setSort(id) })) }] }, { placement: 'bottom-end' })}
              >
                {SORTS.find(([id]) => id === sort)![1]()}
                <Icon name="chevronDown" size={12} />
              </span>
            </div>
            {sorted.slice(0, limit).map((r) => (
              <div key={r.userId} className="nc-mkt-review-item">
                <Stars value={r.rating} size={13} />
                {r.title && <div className="title">{r.title}</div>}
                {r.text && <div className="text">{r.text}</div>}
                <div className="by">{t('lp.templates.text_f3c2', '{authorName} · {updatedDate}', { authorName: r.name || t('lp.templates.anonymous', 'Anonymous'), updatedDate: formatShortDate(r.time) })}</div>
              </div>
            ))}
            {sorted.length > limit && (
              <button className="nc-btn outline" onClick={() => setLimit((l) => l + 10)}>{t('lp.templates.load_more', 'Load more')}</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// /site/<domain>: the root of a workspace's Sites domain (Settings › Public pages › Domains). It opens the
// domain's homepage (a published page picked in Settings), or a not-found page when the domain has no live
// homepage. Works without signing in, like any published page.
import { useEffect, useState } from 'react';
import { pageSlug } from '@nc/shared/ids.ts';
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { t } from '../shell/i18n.ts';

export function SiteRoot({ domain }: { domain: string }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setMissing(false);
    api<{ pageId: string; title: string }>('getSiteHome', { domain })
      .then((r) => { if (live) navigate(`/public/${pageSlug(r.title, r.pageId)}`, { replace: true }); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [domain]);
  if (!missing) return <div className="nc-public-page" />;
  return (
    <div className="nc-public-page">
      <div className="nc-public-message" data-testid="site-not-found">
        <div className="title">{t('lp.settings.we_couldn_t_find_this_page', 'We couldn’t find this page')}</div>
        <div className="sub">{t('lp.settings.this_might_be_deleted_moved_or', 'This might be deleted, moved, or not shared with you. Double-check the link, then retry.')}</div>
        <button className="nc-dialog-btn outline" onClick={() => navigate('/')}>{t('lp.settings.open_litpage', 'Open Litpage')}</button>
      </div>
    </div>
  );
}

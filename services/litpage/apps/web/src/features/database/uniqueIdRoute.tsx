// ID URLs: /<domain>/ opens the page whose Unique ID is (resolveUniqueId on the server
// only finds pages the viewer can open). Unknown IDs show the not-found state.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { openPage } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';

/** Last URL segment that looks a prefixed Unique ID (""). */
export const UNIQUE_ID_SEGMENT = /^[A-Za-z][A-Za-z0-9-]{0,9}-\d{1,9}$/;

export function UniqueIdRedirect({ uid }: { uid: string }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setMissing(false);
    api<{ pageId: string; recordMap?: any }>('resolveUniqueId', { uid, spaceId: useSession.getState().spaceId })
      .then((res) => {
        if (!live) return;
        if (res.recordMap) records.mergeRecordMap(res.recordMap);
        openPage(res.pageId, { replace: true });
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [uid]);
  if (!missing) return null;
  return (
    <div className="nc-uid-missing" style={{ padding: '120px 24px', textAlign: 'center', color: 'var(--lp-text-secondary)', fontSize: 14 }} data-testid="unique-id-missing">
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--lp-text-primary)', marginBottom: 8 }}>This entry could not be found</div>
      <div>{`No page with the ID ${uid} — it may have been deleted, or you may not have access.`}</div>
    </div>
  );
}

// Confirmation dialog (centered card on a dim backdrop): message, optional description,
// red/primary confirm and Cancel. Used by comment deletion, version restore, unpublish, etc.
import type { ReactNode } from 'react';
import { openOverlay } from '../../components/overlay.tsx';
import { t } from '../shell/i18n.ts';
import './dialogs.css';

export function confirmDialog(opts: { message: ReactNode; description?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean; width?: number }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean, close: () => void) => {
      if (done) return;
      done = true;
      resolve(v);
      close();
    };
    openOverlay(
      (close) => (
        <div className="nc-confirm" role="alertdialog" style={{ width: opts.width ?? 300 }}>
          <div className="nc-confirm-message">{opts.message}</div>
          {opts.description && <div className="nc-confirm-description">{opts.description}</div>}
          <div className="nc-confirm-buttons">
            <button autoFocus className={`nc-dialog-btn ${opts.danger === false ? 'primary' : 'danger'}`} onClick={() => finish(true, close)}>
              {opts.confirmLabel ?? t('lp.page.delete', 'Delete')}
            </button>
            <button className="nc-dialog-btn outline" onClick={() => finish(false, close)}>
              {opts.cancelLabel ?? t('lp.page.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ),
      { placement: 'center', backdrop: 'dim', onClose: () => { if (!done) { done = true; resolve(false); } } },
    );
  });
}

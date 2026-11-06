// Centered modal (settings, search, page history…) with dimmed backdrop, Escape to close.
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUI } from '../lib/store/ui.ts';
import './modal.css';

export function Modal({ open, onClose, children, width, height, top, style, className, dim = true }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  height?: number | string;
  top?: number | string;
  style?: CSSProperties;
  className?: string;
  dim?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={`nc-modal-layer ${dim ? 'dim' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`nc-modal ${className ?? ''}`} role="dialog" style={{ width, height, marginTop: top, ...style }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ToastLayer() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  // `nc:toast` window event (detail: message string or { message, action }) for modules that can't import the store
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as string | { message?: string; action?: { label: string; run: () => void } } | undefined;
      const message = typeof d === 'string' ? d : d?.message;
      if (message) useUI.getState().toast(message, typeof d === 'object' ? d?.action : undefined);
    };
    window.addEventListener('nc:toast', onToast);
    return () => window.removeEventListener('nc:toast', onToast);
  }, []);
  return (
    <div className="nc-toasts">
      {toasts.map((t) => (
        <div key={t.id} className="nc-toast">
          <span>{t.message}</span>
          {t.action && (
            <button className="nc-toast-action" onClick={() => { t.action!.run(); dismiss(t.id); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

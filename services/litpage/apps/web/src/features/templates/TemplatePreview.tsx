// Live read-only preview of a template page (records loaded with getTemplatePreview, rendered by the page view in
// public/read-only mode). Clicks inside the preview are swallowed so links don't navigate away from the gallery.
import { Component, useEffect, useState, type ReactNode } from 'react';
import { PageView } from '../page/PageView.tsx';
import { loadTemplatePreview, type TemplateInfo } from './api.ts';
import { TemplateThumb } from './TemplateThumb.tsx';

export function TemplatePreview({ tpl, className }: { tpl: TemplateInfo; className?: string }) {
  const [pageId, setPageId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setPageId(null);
    setFailed(false);
    loadTemplatePreview(tpl.id)
      .then((id) => alive && setPageId(id))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [tpl.id]);
  return (
    <div
      className={`nc-tpreview ${className ?? ''}`}
      onClickCapture={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('a, [role=button], [role=checkbox], button, input, [contenteditable=true]')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onMouseDownCapture={(e) => {
        if ((e.target as HTMLElement).closest('[contenteditable=true], input')) e.preventDefault();
      }}
    >
      {pageId ? (
        <PreviewBoundary fallback={<TemplateThumb tpl={tpl} size="lg" />}>
          <PageView pageId={pageId} state="ok" publicView />
        </PreviewBoundary>
      ) : failed ? (
        <TemplateThumb tpl={tpl} size="lg" />
      ) : (
        <div className="nc-tpreview-loading"><TemplateThumb tpl={tpl} size="lg" /></div>
      )}
    </div>
  );
}

/** The page view belongs to another work stream; never let a preview failure break the gallery. */
class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(e: unknown) {
    console.warn('[templates] preview failed', e);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

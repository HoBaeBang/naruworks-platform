// HTML block (new 2026; DOM class lit-embed-block, record = embed + format.embed_variant "html_artifact" with
// properties.source pointing at the uploaded HTML file. Placeholder “Create or upload HTML content”; popover
// tab “Add”, dashed drop zone “Upload an HTML file / Or drop a file here”, “Generate with AI” tiles
// (Slides, Dashboard, Report, Explainer, Prototype, Game) and "Describe your idea…" (Beta). Rendering uses a
// sandboxed iframe (scripts allowed, no same-origin). "Edit HTML" opens a source editor with live preview; saving
// uploads a new.html file. AI tiles/prompt dispatch `nc:html-ai` (handled by the AI feature); unhandled, they open
// the editor with a starter document.
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { uploadFile } from '../../../lib/api.ts';
import { getBlock, run, setFormat, setProperty } from '../../../lib/blocks.ts';
import { useSession } from '../../../lib/store/session.ts';
import { openBlockMenu } from '../BlockMenu.tsx';
import { registerBlockMenu, overrideSlashItem } from './registry.ts';
import { ActionButton, BlockPlaceholder, downloadUrl, fileSizeLabel, originalSourceOf, showCaption, toast } from './shared.tsx';
import { MediaFrame, AlignButton } from './media/MediaFrame.tsx';
import { PickerTabs, useUploads } from './media/MediaPicker.tsx';
import { insertBlock } from './factories.ts';

const TILES: { kind: string; label: string; icon: string; bg: string; fg: string }[] = [
  { kind: 'slides', label: 'Slides', icon: 'presentation', bg: 'var(--lp-orange-bg-secondary)', fg: 'var(--lp-orange-icon-accent, #fb923c)' },
  { kind: 'dashboard', label: 'Dashboard', icon: 'dashboardTile', bg: 'var(--lp-pink-bg-secondary)', fg: 'var(--lp-pink-icon-accent, #f472b6)' },
  { kind: 'report', label: 'Report', icon: 'reportTile', bg: 'var(--lp-red-bg-secondary)', fg: 'var(--lp-red-icon-accent, #fb7185)' },
  { kind: 'explainer', label: 'Explainer', icon: 'helpCircle', bg: 'var(--lp-yellow-bg-secondary)', fg: 'var(--lp-yellow-icon-accent, #fbbf24)' },
  { kind: 'prototype', label: 'Prototype', icon: 'mobilePhone', bg: 'var(--lp-blue-bg-secondary)', fg: 'var(--lp-blue-icon-accent, #818cf8)' },
  { kind: 'game', label: 'Game', icon: 'layers', bg: 'var(--lp-green-bg-secondary)', fg: 'var(--lp-green-icon-accent, #34d399)' },
];

const htmlCache = new Map<string, string>();

async function loadHtml(src: string): Promise<string> {
  const hit = htmlCache.get(src);
  if (hit != null) return hit;
  const res = await fetch(src, { credentials: 'same-origin' });
  const text = await res.text();
  htmlCache.set(src, text);
  return text;
}

/** Store HTML as an uploaded.html file and point the block at it. */
export async function saveHtml(blockId: string, html: string, name = 'index.html') {
  const spaceId = useSession.getState().spaceId ?? undefined;
  const blob = new Blob([html], { type: 'text/html' });
  useUploads.getState().set(blockId, { name, progress: 0 });
  try {
    const res = await uploadFile(blob, name, spaceId);
    htmlCache.set(res.url, html);
    run('htmlBlock.setSource', (tx) => {
      const b = getBlock(blockId);
      if (b && b.type !== 'embed') tx.update('block', blockId, [], { type: 'embed' });
      setProperty(tx, blockId, 'source', [[res.url]]);
      setProperty(tx, blockId, 'title', [[res.name]]);
      setProperty(tx, blockId, 'size', [[fileSizeLabel(res.size)]]);
      setFormat(tx, blockId, { embed_variant: 'html_artifact', block_height: (getBlock(blockId)?.format?.block_height as number | undefined) ?? 480 });
    });
  } catch (e) {
    toast((e as Error).message || 'Upload failed');
  } finally {
    useUploads.getState().set(blockId, null);
  }
}

function starter(kind: string, prompt?: string): string {
  const title = prompt ? prompt.slice(0, 80) : kind[0].toUpperCase() + kind.slice(1);
  const esc = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc}</title>
<style>
  body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 32px; color: #818cf8; background: #fff; }
  h1 { font-size: 28px; margin: 0 0 12px; }
  .card { border: 1px solid #fafafa; border-radius: 12px; padding: 20px; margin-top: 16px; }
</style>
</head>
<body>
  <h1>${esc}</h1>
  <p>${kind === 'game' ? 'Click the button to score points.' : 'Edit this HTML to build your ' + kind + '.'}</p>
  <div class="card">
    <button id="b">Click me</button> <span id="n">0</span>
  </div>
  <script>
    let n = 0; document.getElementById('b').onclick = () => { document.getElementById('n').textContent = String(++n); };
  </script>
</body>
</html>
`;
}

function runAi(blockId: string, kind: string, prompt?: string) {
  const ev = new CustomEvent('nc:html-ai', { detail: { blockId, kind, prompt }, cancelable: true });
  const unhandled = window.dispatchEvent(ev);
  if (unhandled) openHtmlEditor(blockId, starter(kind, prompt));
}

function HtmlPicker({ blockId, close }: { blockId: string; close: () => void }) {
  const [over, setOver] = useState(false);
  const [prompt, setPrompt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.html?$/i.test(f.name) && f.type !== 'text/html') {
      toast('Please upload an .html file');
      return;
    }
    close();
    await saveHtml(blockId, await f.text(), f.name);
  };
  return (
    <PopoverSurface width={540} maxHeight={520} className="lit-media-menu nc-media-picker">
      <PickerTabs tabs={['add']} tab="add" setTab={() => {}} />
      <div className="nc-media-picker-body" style={{ paddingBottom: 12 }}>
        <div
          className={`nc-html-dropzone ${over ? 'over' : ''}`}
          role="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files?.[0]); }}
        >
          <div className="t1"><Icon name="codeAngle" size={18} />Upload an HTML file</div>
          <div className="t2">Or drop a file here</div>
          <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <div className="nc-html-ai-title">Generate with AI</div>
        <div className="nc-html-tiles">
          {TILES.map((t) => (
            <div key={t.kind} role="button" className="nc-html-tile" onClick={() => { close(); runAi(blockId, t.kind); }}>
              <div className="ic" style={{ background: t.bg, color: t.fg }}><Icon name={t.icon} size={20} /></div>
              {t.label}
            </div>
          ))}
        </div>
        <div className="nc-html-prompt">
          <Icon name="pencilLine" size={18} />
          <input
            placeholder="Describe your idea…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && prompt.trim() && !e.nativeEvent.isComposing) {
                e.preventDefault();
                close();
                runAi(blockId, 'custom', prompt.trim());
              }
            }}
          />
          <span className="beta">Beta</span>
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openHtmlPicker(blockId: string, anchor: HTMLElement) {
  return openOverlay((close) => <HtmlPicker blockId={blockId} close={close} />, { anchor, placement: 'bottom', offset: 0 });
}

function HtmlEditor({ blockId, initial, close }: { blockId: string; initial: string; close: () => void }) {
  const [v, setV] = useState(initial);
  const [preview, setPreview] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => setPreview(v), 300);
    return () => clearTimeout(t);
  }, [v]);
  const save = async () => {
    close();
    await saveHtml(blockId, v);
  };
  return (
    <PopoverSurface width="auto" maxHeight="90vh" className="nc-html-editor-pop">
      <div className="nc-html-editor-head">
        <Icon name="codeAngle" size={16} />
        <span>Edit HTML</span>
        <span className="grow" />
        <button className="nc-blk-btn outline" onClick={close}>Cancel</button>
        <button className="nc-blk-btn primary" onClick={() => void save()}>Save</button>
      </div>
      <div className="nc-html-editor">
        <textarea
          autoFocus
          spellCheck={false}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
            if (e.key === 'Tab') {
              e.preventDefault();
              const t = e.currentTarget;
              const s = t.selectionStart;
              const next = v.slice(0, s) + '  ' + v.slice(t.selectionEnd);
              setV(next);
              requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
            }
          }}
        />
        <iframe title="Preview" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={preview} />
      </div>
    </PopoverSurface>
  );
}

export function openHtmlEditor(blockId: string, initial: string) {
  return openOverlay((close) => <HtmlEditor blockId={blockId} initial={initial} close={close} />, { placement: 'center', backdrop: 'dim', closeOnEscape: true });
}

function useHtml(block: BlockRecord): { html: string | null; error?: string } {
  const src = block.type === 'html' ? null : originalSourceOf(block);
  const inline = block.type === 'html' ? toPlainText(block.properties?.title) : null;
  const [state, setState] = useState<{ html: string | null; error?: string }>(() => ({ html: inline ?? (src ? htmlCache.get(src) ?? null : null) }));
  useEffect(() => {
    if (inline != null) {
      setState({ html: inline });
      return;
    }
    if (!src) return;
    let alive = true;
    loadHtml(src).then((h) => alive && setState({ html: h })).catch((e) => alive && setState({ html: null, error: String(e) }));
    return () => {
      alive = false;
    };
  }, [src, inline]);
  return state;
}

export function HtmlBlock({ block, readOnly }: BlockProps) {
  const { html, error } = useHtml(block);
  const uploading = useUploads((s) => s.uploading[block.id]);
  const hasSource = block.type === 'html' ? !!toPlainText(block.properties?.title) : !!originalSourceOf(block);
  if (!hasSource) {
    return (
      <div className="nc-bpad">
        <BlockPlaceholder
          block={block}
          readOnly={readOnly || !!uploading}
          icon={uploading ? <div className="nc-spinner" /> : 'codeAngle'}
          label={uploading ? `Uploading ${uploading.name}…` : 'Create or upload HTML content'}
          onOpen={(el) => openHtmlPicker(block.id, el)}
        />
      </div>
    );
  }
  const height = (block.format?.block_height as number | undefined) ?? 480;
  return (
    <MediaFrame
      block={block}
      readOnly={readOnly}
      heightResizable
      bar={(
        <>
          <AlignButton block={block} />
          <ActionButton icon="pencilLine" tooltip="Edit HTML" onClick={() => html != null && openHtmlEditor(block.id, html)} />
          <ActionButton icon="caption" tooltip="Caption" onClick={() => showCaption(block.id)} />
          <ActionButton icon="expand2" tooltip="Expand" label="Open full-screen view" onClick={() => html != null && openOverlay(() => (
            <div style={{ width: '92vw', height: '86vh', background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--lp-shadow-outset-screen)' }}>
              <iframe title="HTML" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={html} style={{ width: '100%', height: '100%', border: 0 }} />
            </div>
          ), { placement: 'center', backdrop: 'dim' })} />
          <ActionButton icon="ellipsis" tooltip="More actions" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
        </>
      )}
    >
      {(live) => (
        <div className="nc-html-frame" style={{ height: live?.h ?? height }}>
          {html != null ? (
            <iframe title={toPlainText(block.properties?.title) || 'HTML'} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox" srcDoc={html} />
          ) : (
            <div className="nc-media-error-box" style={{ height: '100%', borderRadius: 10 }}>{error ? 'Could not load the HTML file.' : 'Loading…'}</div>
          )}
        </div>
      )}
    </MediaFrame>
  );
}

registerBlock(['html'], HtmlBlock);

registerBlockMenu(['html'], ({ block }) => [
  { label: 'Edit HTML', icon: 'pencilLine', onSelect: () => { const h = toPlainText(block.properties?.title); openHtmlEditor(block.id, h); } },
  { label: 'Caption', icon: 'caption', shortcut: '⌘⌥M', onSelect: () => showCaption(block.id) },
]);

/** Extra menu items for embed blocks with the html_artifact variant (registered through embed.block.tsx's type list). */
export function htmlMenuItems(block: BlockRecord) {
  const src = originalSourceOf(block);
  return [
    { label: 'Edit HTML', icon: 'pencilLine', onSelect: () => { if (src) void loadHtml(src).then((h) => openHtmlEditor(block.id, h)); } },
    { label: 'Replace', icon: 'replace', onSelect: () => { const el = document.querySelector(`[data-block-id="${block.id}"] .nc-media-frame`) as HTMLElement | null; if (el) openHtmlPicker(block.id, el); } },
    { label: 'Caption', icon: 'caption', shortcut: '⌘⌥M', onSelect: () => showCaption(block.id) },
    ...(src ? [{ label: 'Download', icon: 'download', onSelect: () => downloadUrl(src, toPlainText(block.properties?.title) || 'index.html') }] : []),
  ];
}

const createHtml = (ctx: Parameters<typeof insertBlock>[0]) => insertBlock(ctx, 'embed', { format: { embed_variant: 'html_artifact' }, openPicker: true });
overrideSlashItem('html', createHtml);
overrideSlashItem('html-suggested', createHtml);

// open the HTML popover (not the generic embed one) when the slash item dispatches the placeholder event
export { openHtmlPicker as openHtmlPopover };

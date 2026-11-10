// “Store chart as…”: background choice and preview, then Copy as PNG or Download PNG.
// Download SVG. The rendered chart SVG is serialized with its computed colors (CSS variables resolved), framed by the
// chosen background with some padding (no background = transparent PNG / SVG).
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../../../components/Icon.tsx';
import { openOverlay } from '../../../../components/overlay.tsx';
import { useUI } from '../../../../lib/store/ui.ts';

type Background = 'default' | 'gray' | 'none';
const BACKGROUNDS: { id: Background; label: string }[] = [{ id: 'default', label: 'Default' }, { id: 'gray', label: 'Gray' }, { id: 'none', label: 'Transparent' }];
const PAD = 24;

function resolveColor(cssValue: string): string {
  const el = document.createElement('div');
  el.style.display = 'none';
  el.style.color = cssValue;
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  return c;
}

function backgroundColor(bg: Background): string | null {
  if (bg === 'none') return null;
  if (bg === 'gray') return resolveColor('var(--lp-bg-secondary, #f7f7f5)');
  return getComputedStyle(document.body).backgroundColor || '#ffffff';
}

/** Standalone SVG text of the chart: computed styles inlined, optional background frame. */
export function serializeChart(svg: SVGSVGElement, bg: string | null): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll('*');
  const dst = clone.querySelectorAll('*');
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const d = dst[i] as SVGElement;
    for (const prop of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-weight', 'font-family', 'opacity', 'stop-color', 'stop-opacity']) {
      const v = cs.getPropertyValue(prop);
      if (v) d.style.setProperty(prop, v);
    }
  });
  const w = svg.width.baseVal.value;
  const h = svg.height.baseVal.value;
  const width = w + PAD * 2;
  const height = h + PAD * 2;
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('xmlns', NS);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (bg) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', '12');
    rect.setAttribute('fill', bg);
    root.appendChild(rect);
  }
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(${PAD},${PAD})`);
  clone.removeAttribute('class');
  clone.setAttribute('overflow', 'visible');
  g.appendChild(clone);
  root.appendChild(g);
  return { text: new XMLSerializer().serializeToString(root), width, height };
}

async function pngBlob(text: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('image')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function openChartExport(svg: SVGSVGElement, name: string) {
  openOverlay((close) => <ChartExport svg={svg} name={name} close={close} />, { placement: 'middle', backdrop: 'dim' });
}

function ChartExport({ svg, name, close }: { svg: SVGSVGElement; name: string; close: () => void }) {
  const [bg, setBg] = useState<Background>('default');
  const out = useMemo(() => serializeChart(svg, backgroundColor(bg)), [svg, bg]);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([out.text], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [out]);
  const toast = (m: string) => useUI.getState().toast(m);
  const copyPng = async () => {
    try {
      const blob = await pngBlob(out.text, out.width, out.height);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied to clipboard');
      close();
    } catch {
      toast('Couldn’t copy the chart. Try downloading it instead.');
    }
  };
  const downloadPng = async () => {
    try {
      download(await pngBlob(out.text, out.width, out.height), `${name}.png`);
      close();
    } catch {
      toast('Couldn’t export the chart');
    }
  };
  const downloadSvg = () => {
    download(new Blob([out.text], { type: 'image/svg+xml' }), `${name}.svg`);
    close();
  };
  return (
    <div className="nc-chart-export" role="dialog" aria-label="Store chart as…" data-testid="chart-export">
      <div className="nc-chart-export-head">
        <span>Store chart as…</span>
        <div role="button" className="nc-icon-btn" aria-label="Close" onClick={close}><Icon name="xMarkSmall" size={18} /></div>
      </div>
      <div className="nc-chart-export-label">Preview</div>
      <div className={`nc-chart-export-preview ${bg === 'none' ? 'checker' : ''}`}>
        {preview && <img src={preview} alt="Chart preview" style={{ aspectRatio: `${out.width} / ${out.height}` }} />}
      </div>
      <div className="nc-chart-export-row">
        <span className="nc-chart-export-label inline">Background</span>
        <div className="nc-chart-export-bgs" role="radiogroup" aria-label="Background">
          {BACKGROUNDS.map((b) => (
            <div key={b.id} role="radio" aria-checked={bg === b.id} aria-label={b.label} data-tooltip={b.label} className={`nc-chart-export-bg bg-${b.id} ${bg === b.id ? 'on' : ''}`} onClick={() => setBg(b.id)} />
          ))}
        </div>
      </div>
      <div className="nc-chart-export-actions">
        <div role="button" className="nc-btn" onClick={() => void copyPng()}>Copy as PNG</div>
        <div role="button" className="nc-btn" onClick={() => void downloadPng()}>Download PNG</div>
        <div role="button" className="nc-btn primary" onClick={downloadSvg}>Download SVG</div>
      </div>
    </div>
  );
}

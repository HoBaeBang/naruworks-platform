// Summary citations: the summary's citation chips are links "#mtg-cite-<transcript line id>". Hovering one shows the
// cited transcript snippet; clicking it opens the Transcript tab at that line. Listeners run on window before the
// editor's link handling, which would open the link or show the link pill.
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { records } from '../../lib/store/records.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { t } from '../shell/i18n.ts';
import { clock } from './Transcript.tsx';

const SELECTOR = 'a.lit-link-token[href^="#mtg-cite-"]';

function lineIdOf(a: Element): string | null {
  const m = /^#mtg-cite-([0-9a-f-]{36})$/.exec(a.getAttribute('href') ?? '');
  return m ? m[1] : null;
}

let closeHover: (() => void) | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function hideSoon() {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { closeHover?.(); closeHover = null; }, 150);
}

function CitationPopup({ lineId, n }: { lineId: string; n: string }) {
  const line = records.get<BlockRecord>('block', lineId);
  const f = (line?.format ?? {}) as Record<string, unknown>;
  return (
    <PopoverSurface width={340}>
      <div className="nc-mtg-cite-pop" onMouseEnter={() => { if (hideTimer) clearTimeout(hideTimer); }} onMouseLeave={hideSoon}>
        <div className="h">{t('lp.meetings.citation', 'Citation {number}', { number: n })}</div>
        {line && line.alive !== false ? (
          <>
            <div className="who">{String(f.meeting_speaker ?? '')} · {clock(Number(f.meeting_start_ms ?? 0))}</div>
            <div className="q">{toPlainText(line.properties?.title).slice(0, 400)}</div>
          </>
        ) : (
          <div className="q">{t('lp.meetings.transcript_deleted', 'Transcript deleted')}</div>
        )}
      </div>
    </PopoverSurface>
  );
}

function install() {
  window.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.(SELECTOR);
    if (!a || e.button !== 0) return;
    const lineId = lineIdOf(a);
    const host = a.closest<HTMLElement>('[data-meeting-block]');
    if (!lineId || !host) return;
    e.preventDefault();
    e.stopPropagation();
    hideSoon();
    window.dispatchEvent(new CustomEvent('nc:mtg-cite', { detail: { blockId: host.dataset.meetingBlock, lineId } }));
  }, true);
  window.addEventListener('mouseover', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.(SELECTOR);
    if (!a) return;
    // keep the editor's link pill away from citation chips
    e.stopPropagation();
    const lineId = lineIdOf(a);
    if (!lineId) return;
    if (hideTimer) clearTimeout(hideTimer);
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      closeHover?.();
      closeHover = openOverlay(() => <CitationPopup lineId={lineId} n={(a.textContent ?? '').trim()} />, { anchor: a as HTMLElement, placement: 'top-start', offset: 6, backdrop: 'none', noFocus: true });
    }, 250);
  }, true);
  window.addEventListener('mouseout', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.(SELECTOR);
    if (a) hideSoon();
  }, true);
}

let installed = false;
export function installCitations() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  install();
}

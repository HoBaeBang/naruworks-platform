// Remote cursors & selections of other viewers inside the page: a colored caret with the
// person's name flag, translucent selection rectangles, and their avatar beside the block they edit.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { rangeIn } from '../comments/comments.tsx';
import { isMe, usePageViewers, type PresenceData } from './presence.ts';
import { presenceColor, userName, UserAvatar } from './Avatar.tsx';
import './presence.css';

interface Mark {
  key: string;
  userId: string;
  color: string;
  name: string;
  caret: { left: number; top: number; height: number } | null;
  rects: { left: number; top: number; width: number; height: number }[];
  block: { top: number; right: number } | null;
}

export function PresenceLayer({ pageId, rootRef }: { pageId: string; rootRef: RefObject<HTMLElement | null> }) {
  const viewers = usePageViewers(pageId);
  const version = useTableVersion(['block']);
  const layerRef = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener('resize', on);
    const id = setInterval(on, 1500); // reflow safety net (images loading, toggles)
    return () => {
      window.removeEventListener('resize', on);
      clearInterval(id);
    };
  }, []);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const layer = layerRef.current;
    if (!root || !layer) return;
    const base = layer.getBoundingClientRect();
    const out: Mark[] = [];
    for (const v of viewers) {
      if (isMe(v)) continue;
      const d = v.data as PresenceData | null | undefined;
      if (!d?.blockId) continue;
      const leaf = root.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${CSS.escape(d.blockId)}"][data-property="${CSS.escape(d.property ?? 'title')}"]`);
      const blockEl = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(d.blockId)}"]`);
      if (!leaf && !blockEl) continue;
      const u = records.get<UserRecord>('lit_user', v.userId);
      const color = presenceColor(v.userId);
      const mark: Mark = { key: v.clientId, userId: v.userId, color, name: userName(u), caret: null, rects: [], block: null };
      if (leaf) {
        const len = (leaf.textContent ?? '').length + 64;
        const start = Math.min(d.start, len);
        const end = Math.min(d.end, len);
        if (end > start) {
          const r = rangeIn(leaf, start, end);
          for (const rc of Array.from(r?.getClientRects() ?? [])) {
            if (rc.width < 1) continue;
            mark.rects.push({ left: rc.left - base.left, top: rc.top - base.top, width: rc.width, height: rc.height });
          }
        }
        const caretRange = rangeIn(leaf, end, end);
        let cr = caretRange?.getClientRects()[0] ?? caretRange?.getBoundingClientRect();
        if (!cr || (!cr.height && !cr.top)) {
          const lr = leaf.getBoundingClientRect();
          cr = new DOMRect(lr.left + 2, lr.top + 2, 0, Math.min(lr.height, 24));
        }
        mark.caret = { left: cr.left - base.left, top: cr.top - base.top, height: Math.max(cr.height, 16) };
      }
      const br = (blockEl ?? leaf)!.getBoundingClientRect();
      mark.block = { top: br.top - base.top, right: br.right - base.left };
      out.push(mark);
    }
    setMarks((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [viewers, version, tick, rootRef]);

  return (
    <div className="nc-presence-layer" ref={layerRef} aria-hidden>
      {marks.map((m) => (
        <div key={m.key} className="nc-remote" style={{ ['--presence-color' as any]: m.color }}>
          {m.rects.map((r, i) => <div key={i} className="nc-remote-selection" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />)}
          {m.caret && (
            <div className="nc-remote-caret" style={{ left: m.caret.left - 1, top: m.caret.top, height: m.caret.height }}>
              <div className="nc-remote-flag">{m.name}</div>
            </div>
          )}
          {m.block && (
            <div className="nc-remote-avatar" style={{ top: m.block.top + 2, left: m.block.right + 8 }} title={`${m.name} is editing`}>
              <UserAvatar userId={m.userId} size={20} ring={m.color} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

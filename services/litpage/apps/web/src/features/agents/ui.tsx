// Small pieces shared by the agent settings, trigger and share surfaces: the switch and the page / database picker
// ("Search pages and databases…", most recently visited first).
import { useEffect, useState } from 'react';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { useSession } from '../../lib/store/session.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { agentApi, type ResourceHit } from './agentsApi.ts';

export function Toggle({ checked, onChange, disabled, label, testId }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      className={`nc-agent-toggle ${checked ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
    >
      <span className="knob" />
    </button>
  );
}

export function ResourceIcon({ icon, database, size = 16 }: { icon: string | null | undefined; database: boolean; size?: number }) {
  return <PageIcon icon={icon ?? undefined} fallback={database ? 'agentDatabase' : 'page'} size={size} />;
}

function ResourcePicker({ close, onPick, kind }: { close: () => void; onPick: (r: ResourceHit) => void; kind?: 'page' | 'database' }) {
  const spaceId = useSession((s) => s.spaceId);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ResourceHit[] | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!spaceId) return;
    let alive = true;
    const timer = setTimeout(() => {
      void agentApi.searchResources(spaceId, q, kind)
        .then((r) => alive && (setRows(r.results), setActive(0)))
        .catch(() => alive && setRows([]));
    }, q ? 150 : 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, spaceId, kind]);
  const pick = (r: ResourceHit | undefined) => {
    if (!r) return;
    onPick(r);
    close();
  };
  return (
    <PopoverSurface width={340} maxHeight={360} className="nc-agent-picker">
      <div className="nc-agent-picker-search">
        <input
          autoFocus
          value={q}
          aria-label={kind === 'database' ? t('lp.agents.select_database', 'Select database') : t('lp.agents.find_a_page_or_database', 'Find a page or database')}
          placeholder={kind === 'database' ? t('lp.agents.search_databases', 'Search databases...') : t('lp.agents.find_a_page_or_database_0cbc', 'Find a page or database...')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min((rows?.length ?? 1) - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(rows?.[active]); }
          }}
        />
      </div>
      <div className="nc-agent-picker-list" role="listbox">
        {rows === null && <div className="nc-agent-muted pad">{t('lp.agents.loading', 'Loading…')}</div>}
        {rows?.length === 0 && <div className="nc-agent-muted pad">{q ? t('lp.agents.no_matches', 'No matches') : t('lp.agents.type_to_search', 'Start typing to search…')}</div>}
        {rows?.map((r, i) => (
          <div key={r.blockId} role="option" aria-selected={i === active} className={`nc-agent-picker-row ${i === active ? 'on' : ''}`} data-block-id={r.blockId} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}>
            <span className="nc-agent-picker-icon"><ResourceIcon icon={r.icon} database={r.database} /></span>
            <span className="nc-ellipsis">{r.title}</span>
            {r.maxRole === 'reader' && <span className="nc-agent-picker-hint">{t('lp.agents.view_only', 'View only')}</span>}
          </div>
        ))}
      </div>
    </PopoverSurface>
  );
}

/** "+ Add pages" / "Select database": search the pages and databases I can share with an agent. */
export function openResourcePicker(anchor: Anchor, onPick: (r: ResourceHit) => void, kind?: 'page' | 'database') {
  return openOverlay((close) => <ResourcePicker close={close} onPick={onPick} kind={kind} />, { anchor, placement: 'bottom-start', offset: 4 });
}


interface ChecklistItem { id: string; label: string; hint?: string }

function Checklist({ items, initial, allLabel, search, onChange }: { items: ChecklistItem[]; initial: string[]; allLabel?: string; search?: string; onChange: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState('');
  const list = items.filter((i) => !q || `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const apply = (next: string[]) => {
    setSel(next);
    onChange(next);
  };
  return (
    <PopoverSurface width={280} maxHeight={340} className="nc-agent-picker">
      {search && (
        <div className="nc-agent-picker-search">
          <input autoFocus value={q} aria-label={search} placeholder={search} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <div className="nc-agent-picker-list" role="listbox" aria-multiselectable="true">
        {allLabel && !q && (
          <div role="option" aria-selected={!sel.length} className="nc-agent-picker-row" onClick={() => apply([])}>
            <span className="nc-ellipsis">{allLabel}</span>
            {!sel.length && <span className="nc-agent-picker-check" aria-hidden>✓</span>}
          </div>
        )}
        {list.map((i) => {
          const on = sel.includes(i.id);
          return (
            <div key={i.id} role="option" aria-selected={on} className="nc-agent-picker-row" onClick={() => apply(on ? sel.filter((x) => x !== i.id) : [...sel, i.id])}>
              <span className="nc-ellipsis">{i.label}</span>
              {i.hint && <span className="nc-agent-picker-hint">{i.hint}</span>}
              {on && <span className="nc-agent-picker-check" aria-hidden>✓</span>}
            </div>
          );
        })}
        {!list.length && <div className="nc-agent-muted pad">{t('lp.agents.no_matches', 'No matches')}</div>}
      </div>
    </PopoverSurface>
  );
}

/** Multi-select popover that stays open while toggling (watched properties, "Run only for"). */
export function openChecklist(anchor: Anchor, opts: { items: ChecklistItem[]; selected: string[]; allLabel?: string; search?: string; onChange: (ids: string[]) => void }) {
  return openOverlay(() => <Checklist items={opts.items} initial={opts.selected} allLabel={opts.allLabel} search={opts.search} onChange={opts.onChange} />, { anchor, placement: 'bottom-start', offset: 4 });
}

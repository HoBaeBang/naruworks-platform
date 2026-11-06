// Renders agent activity steps, approval prompts, change summaries, and tool calls.
import { useState } from 'react';
import * as L from 'lucide-react';
import { Icon, registerIcons } from '../../components/Icon.tsx';
import { openPage } from '../../lib/router.ts';
import { getBlock } from '../../lib/blocks.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { AiMarkdown } from './AiMarkdown.tsx';
import type { AgentStep, ApprovalPayload, StepRef, TouchedPage, TurnChanges } from './aiApi.ts';

registerIcons({
  aiStepSearch: L.Search,
  aiStepView: L.FileText,
  aiStepCreate: L.FilePlus2,
  aiStepEdit: L.FilePen,
  aiStepTrash: L.Trash2,
  aiStepMove: L.CornerUpRight,
  aiStepDatabase: L.Table2,
  aiStepComment: L.MessageSquare,
  aiStepInbox: L.Inbox,
  aiStepGlobe: L.Globe,
  aiStepPlug: L.Plug,
  aiStepPlan: L.ListChecks,
  aiStepMemory: L.Brain,
  aiStepError: L.CircleAlert,
  aiStepHistory: L.History,
  aiStepPeople: L.Users,
  aiStepSkill: L.BookOpenCheck,
});

const STEP_ICON: Record<string, string> = {
  search_workspace: 'aiStepSearch', read_page: 'aiStepView', query_database: 'aiStepDatabase', read_comments: 'aiStepComment',
  view_version_history: 'aiStepHistory', list_people: 'aiStepPeople', list_notifications: 'aiStepInbox', use_skill: 'aiStepSkill',
  create_pages: 'aiStepCreate', update_page: 'aiStepEdit', delete_pages: 'aiStepTrash', move_pages: 'aiStepMove', create_database: 'aiStepDatabase',
  update_database: 'aiStepDatabase', add_comment: 'aiStepComment', update_notifications: 'aiStepInbox', update_memory: 'aiStepMemory',
  create_skill: 'aiStepSkill', propose_plan: 'aiStepPlan', web_search: 'aiStepGlobe', web_fetch: 'aiStepGlobe', mcp: 'aiStepPlug',
};

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function RefChip({ r }: { r: StepRef }) {
  if (r.url) {
    return (
      <a className="nc-ai-ref" href={r.url} target="_blank" rel="noopener noreferrer" data-tooltip={r.url}>
        <span className="nc-ai-ref-fav">{host(r.url).slice(0, 1).toUpperCase()}</span>
        <span className="nc-ellipsis">{r.title || host(r.url)}</span>
      </a>
    );
  }
  return (
    <span role="link" className="nc-ai-ref" onClick={() => r.pageId && openPage(r.pageId)}>
      <PageIcon block={getBlock(r.pageId)} size={14} />
      <span className="nc-ellipsis">{r.title || 'Untitled'}</span>
    </span>
  );
}

function McpDetails({ mcp }: { mcp: NonNullable<AgentStep['mcp']> }) {
  const [tab, setTab] = useState<'input' | 'response'>('response');
  return (
    <div className="nc-ai-mcp">
      <div className="nc-ai-mcp-tabs" role="tablist">
        <span role="tab" aria-selected={tab === 'input'} className={tab === 'input' ? 'active' : ''} onClick={() => setTab('input')}>Input</span>
        <span role="tab" aria-selected={tab === 'response'} className={tab === 'response' ? 'active' : ''} onClick={() => setTab('response')}>Response</span>
      </div>
      <pre className="nc-ai-mcp-body">{tab === 'input' ? mcp.input || '{}' : mcp.output ?? 'Waiting on a reply…'}</pre>
    </div>
  );
}

function StepRow({ s, onAnswer }: { s: AgentStep; onAnswer?: (approvalId: string, decision: 'accept' | 'decline') => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const running = s.status === 'running';
  const refs = s.refs ?? [];
  const shownRefs = refs.slice(0, 3);
  const icon = s.status === 'error' ? 'aiStepError' : STEP_ICON[s.tool] ?? 'aiStepView';
  const expandable = !!s.mcp || refs.length > 3;
  return (
    <div className={`nc-ai-agent-step ${s.status}`} data-tool={s.tool} data-status={s.status}>
      <div className="nc-ai-agent-step-row" role={expandable ? 'button' : undefined} onClick={expandable ? () => setOpen(!open) : undefined}>
        <span className="nc-ai-agent-step-icon"><Icon name={icon} size={16} /></span>
        <span className={`nc-ai-agent-step-label ${running ? 'nc-ai-shimmer' : ''}`}>{s.label}</span>
        {s.detail && !(refs.length && !s.mcp && refs.some((r) => r.title === s.detail)) && <span className="nc-ai-agent-step-detail nc-ellipsis">{s.detail}</span>}
        {s.status === 'declined' && <span className="nc-ai-agent-step-tag">Rejected</span>}
        {shownRefs.length > 0 && !s.mcp && (
          <span className="nc-ai-agent-step-refs" onClick={(e) => e.stopPropagation()}>
            {shownRefs.map((r, i) => <RefChip key={i} r={r} />)}
            {refs.length > 3 && <span className="nc-ai-agent-step-more" role="button" onClick={() => setOpen(!open)}>+{refs.length - 3}</span>}
          </span>
        )}
        {expandable && <span className="nc-ai-agent-step-chev"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} /></span>}
      </div>
      {s.status === 'error' && s.error && <div className="nc-ai-agent-step-error">{s.error}</div>}
      {open && s.mcp && <McpDetails mcp={s.mcp} />}
      {open && !s.mcp && refs.length > 3 && <div className="nc-ai-agent-step-allrefs">{refs.map((r, i) => <RefChip key={i} r={r} />)}</div>}
      {s.status === 'waiting' && s.approval && onAnswer && <ApprovalCard a={s.approval} onAnswer={onAnswer} />}
    </div>
  );
}


export function StepsList({ steps, onAnswer }: { steps: AgentStep[]; onAnswer?: (approvalId: string, decision: 'accept' | 'decline') => Promise<void> }) {
  if (!steps.length) return null;
  return (
    <div className="nc-ai-agent-steps" data-testid="ai-agent-steps">
      {steps.map((s) => <StepRow key={s.id} s={s} onAnswer={onAnswer} />)}
    </div>
  );
}


export function ApprovalCard({ a, onAnswer }: { a: ApprovalPayload; onAnswer: (approvalId: string, decision: 'accept' | 'decline') => Promise<void> }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const answer = (d: 'accept' | 'decline') => {
    if (busy) return;
    setBusy(d);
    void onAnswer(a.id, d).catch(() => setBusy(null));
  };
  const longPreview = (a.markdown?.length ?? 0) > 600 || (a.removed?.join('\n').length ?? 0) > 600;
  return (
    <div className={`nc-ai-approval ${a.danger ? 'danger' : ''}`} role="group" aria-label="Approval" data-testid="ai-approval-card">
      <div className="nc-ai-approval-title">{a.title}</div>
      {a.description && <div className="nc-ai-approval-desc">{a.description}</div>}
      {(a.markdown || a.removed?.length || a.properties?.length || a.plan || (a.pages?.length ?? 0) > 1) && (
        <div className={`nc-ai-approval-preview ${longPreview && !expanded ? 'clamped' : ''}`}>
          {a.plan && (
            <ol className="nc-ai-approval-plan">
              {a.plan.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          {a.properties?.length ? (
            <div className="nc-ai-approval-props">
              {a.properties.map((p, i) => (
                <div key={i} className="nc-ai-approval-prop">
                  <span className="nc-ai-approval-prop-name">{p.name}</span>
                  <span className="nc-ai-approval-prop-value">{p.value}</span>
                </div>
              ))}
            </div>
          ) : null}
          {a.removed?.length ? (
            <div className="nc-ai-approval-removed" aria-label="Removed content">
              {a.removed.map((r, i) => <div key={i} className="nc-ai-approval-removed-unit">{r}</div>)}
            </div>
          ) : null}
          {a.markdown?.trim() ? <div className="nc-ai-approval-added"><AiMarkdown text={a.markdown} sources={[]} /></div> : null}
          {!a.markdown && !a.plan && (a.pages?.length ?? 0) > 1 && (
            <ul className="nc-ai-approval-pages">{a.pages!.map((p, i) => <li key={i}>{p.title || 'Untitled'}</li>)}</ul>
          )}
        </div>
      )}
      {longPreview && (
        <div role="button" className="nc-ai-approval-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show more'}</div>
      )}
      <div className="nc-ai-approval-foot">
        <span className="nc-ai-approval-ask">Continue with this step?</span>
        <div className="nc-ai-approval-buttons">
          <div role="button" tabIndex={0} aria-disabled={!!busy} className="nc-btn outline small" onClick={() => answer('decline')}>Reject</div>
          <div role="button" tabIndex={0} aria-disabled={!!busy} className={`nc-btn small ${a.danger ? 'danger' : 'primary'}`} onClick={() => answer('accept')}>
            {busy === 'accept' ? '…' : a.confirmLabel || 'Continue'}
          </div>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<TouchedPage['action'], string> = {
  created: 'Created', updated: 'Updated', deleted: 'Sent to trash', moved: 'Moved', commented: 'Commented', restored: 'Restored',
};


export function ChangesCard({ changes, onUndo }: { changes: TurnChanges; onUndo?: () => Promise<{ conflicts: number } | void> }) {
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pages = changes.pages;
  const real = pages.filter((p) => p.pageId);
  const title = real.length === 1 ? `Updated ${real[0].title || 'Untitled'}` : real.length > 1 ? `Changes made to ${real.length} pages` : 'Changes made';
  const undo = async () => {
    if (!onUndo || busy) return;
    setBusy(true);
    try {
      const r = await onUndo();
      if (r && r.conflicts) setNote('Some changes were edited after Litpage AI made them and were kept.');
    } catch (e) {
      setNote((e as Error)?.message || 'That turn could not be undone. Try again.');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <div className={`nc-ai-changes ${changes.undone ? 'reverted' : ''}`} data-testid="ai-changes-card">
      <div className="nc-ai-changes-head">
        <span className="nc-ai-changes-icon"><Icon name={changes.undone ? 'undo' : 'aiStepEdit'} size={16} /></span>
        <span className="nc-ai-changes-title nc-ellipsis">{changes.undone ? 'Changes reverted' : title}</span>
        <div className="nc-ai-changes-actions">
          {pages.length > 0 && (
            <div role="button" className="nc-ai-changes-btn" onClick={() => setShow(!show)}>{show ? 'Hide changes' : 'Show changes'}</div>
          )}
          {!changes.undone && onUndo && !confirm && (
            <div role="button" className="nc-ai-changes-btn" onClick={() => setConfirm(true)}>
              <Icon name="undo" size={14} />
              <span>Undo</span>
            </div>
          )}
          {confirm && (
            <>
              <div role="button" className="nc-ai-changes-btn" onClick={() => setConfirm(false)}>Cancel</div>
              <div role="button" className="nc-ai-changes-btn danger" aria-disabled={busy} onClick={() => void undo()}>{busy ? 'Undoing…' : 'Confirm Undo'}</div>
            </>
          )}
        </div>
      </div>
      {show && (
        <div className="nc-ai-changes-list">
          {pages.map((p, i) => (
            <div key={`${p.pageId}-${i}`} className="nc-ai-changes-row">
              <span className="nc-ai-changes-action">{ACTION_LABEL[p.action] ?? 'Updated'}</span>
              {p.pageId ? (
                <span role="link" className="nc-ai-ref" onClick={() => openPage(p.pageId)}>
                  <PageIcon block={getBlock(p.pageId)} size={14} />
                  <span className="nc-ellipsis">{p.title || 'Untitled'}</span>
                </span>
              ) : <span className="nc-ai-changes-plain">{p.title}</span>}
              {p.pageId && p.action !== 'deleted' && !changes.undone && (
                <span role="button" className="nc-ai-changes-open" onClick={() => openPage(p.pageId)}>Open page</span>
              )}
            </div>
          ))}
        </div>
      )}
      {note && <div className="nc-ai-changes-note">{note}</div>}
    </div>
  );
}

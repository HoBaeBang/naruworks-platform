// Lists agent runs by status and shows each run's trigger, steps, result, changes, and access controls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RUN_STATUS_LABEL } from '@nc/shared/agents.ts';
import { Icon } from '../../components/Icon.tsx';
import { openPage } from '../../lib/router.ts';
import { formatDateTime, timeAgo } from '../../lib/format.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { AiMarkdown } from '../ai/AiMarkdown.tsx';
import { ChangesCard, StepsList } from '../ai/AgentSteps.tsx';
import type { AgentStep, SourceRef, TurnChanges } from '../ai/aiApi.ts';
import { agentApi, toastError, type AgentDetail, type RunJson } from './agentsApi.ts';
import { canEditAgent, useAgentPage } from './agentPage.ts';

type Filter = 'all' | 'failed' | 'success' | 'in_progress' | 'needs_review';

const FILTERS: [Filter, string, string][] = [
  ['all', 'nc.agents.activity.all', 'All'],
  ['failed', 'nc.agents.activity.failed', 'Failed'],
  ['success', 'nc.agents.activity.successful', 'Successful'],
  ['in_progress', 'nc.agents.activity.inProgress', 'In progress'],
  ['needs_review', 'workflow.pausedReason.needsReview.short', 'Needs review'],
];

export const STATUS_ICON: Record<RunJson['status'], { icon: string; tone: string }> = {
  pending: { icon: 'agentClock', tone: 'gray' },
  running: { icon: 'agentClock', tone: 'blue' },
  success: { icon: 'agentCheck', tone: 'green' },
  skipped: { icon: 'agentCheck', tone: 'gray' },
  failed: { icon: 'agentX', tone: 'red' },
  needs_review: { icon: 'agentAlert', tone: 'orange' },
  stopped: { icon: 'agentPause', tone: 'gray' },
};

export function statusLabel(r: Pick<RunJson, 'status' | 'held'>): string {
  if (r.held && r.status === 'pending') return t('lp.agents.paused_c7df', 'Paused');
  return t(`nc.agents.runStatus.${r.status}`, RUN_STATUS_LABEL[r.status]);
}

export function StatusChip({ r }: { r: Pick<RunJson, 'status' | 'held'> }) {
  const s = STATUS_ICON[r.status];
  return (
    <span className={`nc-agent-status ${s.tone}`} data-status={r.status}>
      {r.status === 'running' ? <span className="nc-agent-spinner" aria-hidden /> : <Icon name={s.icon} size={12} />}
      {statusLabel(r)}
    </span>
  );
}

export function runTitle(r: RunJson): string {
  if (r.kind === 'chat') return r.text?.trim() || t('lp.agents.chat', 'Chat');
  return r.triggerLabel || t('lp.agents.run_agent', 'Run agent');
}

function kindLabel(r: RunJson): string {
  switch (r.kind) {
    case 'chat': return t('lp.agents.chat', 'Chat');
    case 'manual': return t('lp.agents.manual_run', 'Manual run');
    case 'sub_agent': return t('lp.agents.called_by_another_agent', 'Called by another agent');
    default: return t('lp.agents.trigger', 'Trigger');
  }
}

export function AgentActivity({ d }: { d: AgentDetail }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [runs, setRuns] = useState<RunJson[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const agentId = d.agent.id;
  const edit = canEditAgent(d);
  const load = useCallback(async (append?: number) => {
    try {
      const r = await agentApi.runs(agentId, filter === 'all' ? undefined : filter, append);
      setRuns((cur) => (append && cur ? [...cur, ...r.runs] : r.runs));
      setMore(r.runs.length >= 50);
    } catch (e) {
      toastError(e);
      setRuns((cur) => cur ?? []);
    }
  }, [agentId, filter]);
  useEffect(() => {
    setRuns(null);
    void load();
  }, [load]);
  // in-flight runs: refresh while something is pending or running
  const busy = runs?.some((r) => r.status === 'pending' || r.status === 'running') ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [busy, load]);
  if (open) return <RunDetail d={d} runId={open} onBack={() => { setOpen(null); void load(); }} />;
  const stopAll = async () => {
    try {
      const r = await agentApi.stopAll(agentId);
      useAgentPage.getState().refresh();
      void load();
      if (r.stopped) useUI.getState().toast(t('lp.agents.ended_count_plural_one_other', 'Ended {count, plural, one {# run} other {# runs}}', { count: r.stopped }));
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-agent-activity" data-testid="agent-activity">
      <div className="nc-agent-activity-head">
        <div className="nc-agent-pills" role="tablist" aria-label={t('lp.agents.activity', 'Activity')}>
          {FILTERS.map(([id, key, label]) => (
            <div key={id} role="tab" aria-selected={filter === id} className={`nc-agent-pill ${filter === id ? 'on' : ''}`} data-filter={id} onClick={() => setFilter(id)}>{t(key, label)}</div>
          ))}
        </div>
        <div className="nc-agent-activity-actions">
          {edit && busy && <button type="button" className="nc-btn outline small" onClick={() => void stopAll()}>{t('lp.agents.stop_every_run', 'Stop every run')}</button>}
          <div role="button" className="nc-agent-icon-btn" aria-label={t('lp.agents.refresh', 'Refresh')} data-tooltip={t('lp.agents.refresh', 'Refresh')} onClick={() => void load()}><Icon name="refresh" size={16} /></div>
        </div>
      </div>
      {runs === null && <div className="nc-agent-loading small" aria-busy="true" />}
      {runs?.length === 0 && (
        <div className="nc-agent-empty" data-testid="agent-activity-empty">
          <Icon name="agentActivity" size={28} />
          <div className="ttl">{filter === 'all' ? t('lp.agents.no_activity_yet', 'No activity yet') : t('lp.agents.the_current_filter_returns_no_runs', 'The current filter returns no runs')}</div>
          {filter === 'all' && <div className="desc">{edit ? t('lp.agents.runs_show_up_here_when_a', 'Runs show up here when a trigger fires, someone clicks Run, or someone chats with the agent.') : t('lp.agents.your_chats_with_this_agent_show', 'Your chats with this agent show up here.')}</div>}
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="nc-agent-runs" role="list">
          {runs.map((r) => (
            <div key={r.id} role="listitem" className="nc-agent-run" data-run-id={r.id} data-status={r.status} onClick={() => setOpen(r.id)}>
              <div className={`nc-agent-run-icon ${STATUS_ICON[r.status].tone}`}>
                {r.status === 'running' ? <span className="nc-agent-spinner" aria-hidden /> : <Icon name={r.kind === 'chat' ? 'agentChat' : r.kind === 'manual' ? 'agentPlay' : 'agentTrigger'} size={16} />}
              </div>
              <div className="nc-agent-run-main">
                <div className="nc-agent-run-title nc-ellipsis">{runTitle(r)}</div>
                <div className="nc-agent-run-sub">
                  <span>{kindLabel(r)}</span>
                  {r.actorName && <span>· {r.actorName}</span>}
                  {r.pageTitle && <span className="nc-ellipsis">· {r.pageTitle}</span>}
                  <span title={formatDateTime(r.createdTime)}>· {timeAgo(r.createdTime)}</span>
                </div>
                {r.status === 'failed' && r.error && <div className="nc-agent-run-error nc-ellipsis">{r.error}</div>}
              </div>
              <div className="nc-agent-run-right">
                <StatusChip r={r} />
                {r.credits > 0 && <span className="nc-agent-run-credits">{t('lp.agents.count_plural_one_other_699b', '{count, plural, one {# usage} other {# uses}}', { count: r.credits })}</span>}
              </div>
            </div>
          ))}
          {more && <button type="button" className="nc-btn outline small nc-agent-more" onClick={() => void load(runs[runs.length - 1].createdTime)}>{t('lp.agents.load_more', 'Load more')}</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- run details

interface RunMessage {
  id: string;
  role: 'user' | 'assistant';
  createdTime: number;
  text: string;
  status: string;
  error: { code: string; message: string } | null;
  steps: AgentStep[];
  sources: SourceRef[];
  changes: TurnChanges | null;
  meta: { facts?: string[]; trigger?: string } | null;
}

function RunDetail({ d, runId, onBack }: { d: AgentDetail; runId: string; onBack: () => void }) {
  const [run, setRun] = useState<RunJson | null>(null);
  const [messages, setMessages] = useState<RunMessage[]>([]);
  const [missing, setMissing] = useState(false);
  const edit = canEditAgent(d);
  const load = useCallback(async () => {
    try {
      const r = await agentApi.runDetail(runId);
      setRun(r.run);
      setMessages(r.messages as RunMessage[]);
    } catch {
      setMissing(true);
    }
  }, [runId]);
  useEffect(() => void load(), [load]);
  const live = run && (run.status === 'pending' || run.status === 'running');
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [live, load]);
  const head = (
    <div role="button" className="nc-agent-back" onClick={onBack}>
      <Icon name="arrowLeft" size={14} />
      <span>{t('lp.agents.activity', 'Activity')}</span>
    </div>
  );
  if (missing) return <div className="nc-agent-activity">{head}<div className="nc-agent-empty"><div className="ttl">{t('lp.agents.this_run_isn_t_available', 'This run isn’t available')}</div></div></div>;
  if (!run) return <div className="nc-agent-activity">{head}<div className="nc-agent-loading small" aria-busy="true" /></div>;
  const runAgain = async () => {
    try {
      await agentApi.run(d.agent.id);
      onBack();
    } catch (e) {
      toastError(e);
    }
  };
  const duration = run.startedTime && run.endedTime ? Math.max(1, Math.round((run.endedTime - run.startedTime) / 1000)) : null;
  const userMsg = messages.find((m) => m.role === 'user');
  const answers = messages.filter((m) => m.role === 'assistant');
  return (
    <div className="nc-agent-activity" data-testid="agent-run-detail" data-run-id={run.id}>
      {head}
      <div className="nc-agent-run-head">
        <div className="nc-agent-run-head-title">{runTitle(run)}</div>
        <div className="nc-agent-run-chips">
          <StatusChip r={run} />
          <span className="nc-agent-chip">{kindLabel(run)}</span>
          {run.model && <span className="nc-agent-chip"><Icon name="agentModel" size={12} />{run.model}</span>}
          <span className="nc-agent-chip"><Icon name="agentCredits" size={12} />{t('lp.agents.count_plural_one_other_699b', '{count, plural, one {# usage} other {# uses}}', { count: run.credits })}</span>
          {duration !== null && <span className="nc-agent-chip"><Icon name="agentClock" size={12} />{duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`}</span>}
          {run.changes > 0 && <span className="nc-agent-chip">{t('lp.agents.count_plural_one_other_b39d', '{count, plural, one {# update} other {# updates}}', { count: run.changes })}</span>}
        </div>
        <div className="nc-agent-run-meta">
          {run.actorName && <span>{t('lp.agents.started_by', 'Started by {name}', { name: run.actorName })} · </span>}
          <span>{formatDateTime(run.createdTime)}</span>
          {run.pageId && run.pageTitle && <> · <span role="button" className="nc-agent-link" onClick={() => openPage(run.pageId!)}>{run.pageTitle}</span></>}
        </div>
        <div className="nc-agent-run-actions">
          {live && (edit || run.actorId === useSession.getState().userId) && (
            <button type="button" className="nc-btn outline small" onClick={() => void agentApi.stopRun(run.id).then(load).catch((e) => toastError(e))}>{t('lp.agents.stop', 'Stop')}</button>
          )}
          {edit && run.status === 'failed' && d.agent.published && <button type="button" className="nc-btn outline small" onClick={() => void runAgain()}>{t('lp.agents.run_again', 'Run again')}</button>}
          {edit && run.status === 'failed' && <button type="button" className="nc-btn outline small" onClick={() => useAgentPage.getState().setSettingsOpen(true)}>{t('lp.agents.review_settings', 'Review settings')}</button>}
        </div>
      </div>
      {run.status === 'failed' && run.error && (
        <div className="nc-agent-run-errorbox" role="alert">
          <Icon name="agentAlert" size={16} />
          <div>
            <div className="ttl">{t('lp.agents.this_run_failed', 'This run failed')}</div>
            <div>{run.error}</div>
          </div>
        </div>
      )}
      {run.status === 'needs_review' && run.review && !run.review.decided && <ReviewCard run={run} canDecide={edit} onDone={load} />}
      {run.review?.decided && <div className="nc-agent-run-note">{run.review.decided === 'allow' ? t('lp.agents.allowed', 'Allowed: {label}', { label: run.review.label }) : t('lp.agents.denied', 'Denied: {label}', { label: run.review.label })}</div>}
      {userMsg && (
        <details className="nc-agent-run-trigger" open={run.kind === 'chat'}>
          <summary>{run.kind === 'chat' ? t('lp.agents.message', 'Message') : t('lp.agents.trigger_details', 'Trigger details')}</summary>
          <div className="nc-agent-run-trigger-body">{userMsg.text}</div>
        </details>
      )}
      {answers.map((m) => (
        <div key={m.id} className="nc-agent-run-answer">
          <StepsList steps={m.steps ?? []} />
          {m.text && <AiMarkdown text={m.text} sources={m.sources ?? []} />}
          {m.error && <div className="nc-agent-run-error">{m.error.message}</div>}
          {m.changes && m.changes.pages.length > 0 && <ChangesCard changes={m.changes} />}
        </div>
      ))}
      {!answers.length && !live && run.result && <div className="nc-agent-run-answer"><AiMarkdown text={run.result} sources={[]} /></div>}
      {!live && <Feedback run={run} />}
    </div>
  );
}

function ReviewCard({ run, canDecide, onDone }: { run: RunJson; canDecide: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(true);
    try {
      await agentApi.resolveReview(run.id, decision);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const r = run.review!;
  return (
    <div className="nc-agent-review" data-testid="agent-run-review">
      <div className="ttl">{r.kind === 'url' ? t('lp.agents.the_agent_wants_to_open_a', 'The agent wants to open a website') : t('lp.agents.the_agent_wants_to_use_a', 'The agent wants to use a tool')}</div>
      <div className="desc">{r.label}{r.reason ? ` — ${r.reason}` : ''}</div>
      {r.kind === 'url' && r.url && <div className="nc-agent-review-url">{r.url}</div>}
      {canDecide ? (
        <div className="nc-agent-review-actions">
          <button type="button" className="nc-btn outline small" disabled={busy} onClick={() => void decide('deny')}>{t('lp.agents.deny', 'Deny')}</button>
          <button type="button" className="nc-btn primary small" disabled={busy} onClick={() => void decide('allow')}>{r.kind === 'url' ? t('lp.agents.allow_and_run_again', 'Allow and run again') : t('lp.agents.allow', 'Allow')}</button>
        </div>
      ) : <div className="desc">{t('lp.agents.someone_who_can_edit_this_agent', 'Someone who can edit this agent needs to review this request.')}</div>}
    </div>
  );
}

function Feedback({ run }: { run: RunJson }) {
  const [rating, setRating] = useState<'positive' | 'negative' | null>(run.feedback?.rating ?? null);
  const [comment, setComment] = useState(run.feedback?.comment ?? '');
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = async (next: 'positive' | 'negative' | null, text = comment) => {
    setRating(next);
    try {
      await agentApi.feedback(run.id, next, text.trim() || undefined);
      setSent(true);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-agent-feedback" data-testid="agent-run-feedback">
      <span className="lbl">{t('lp.agents.how_did_the_agent_do', 'How did the agent do?')}</span>
      <div role="button" aria-pressed={rating === 'positive'} aria-label={t('lp.agents.good_response', 'Good response')} className={`nc-agent-icon-btn ${rating === 'positive' ? 'on' : ''}`} onClick={() => void send(rating === 'positive' ? null : 'positive')}><Icon name="thumbsUp" size={16} /></div>
      <div role="button" aria-pressed={rating === 'negative'} aria-label={t('lp.agents.bad_response', 'Bad response')} className={`nc-agent-icon-btn ${rating === 'negative' ? 'on' : ''}`} onClick={() => { void send(rating === 'negative' ? null : 'negative'); setTimeout(() => ref.current?.focus(), 0); }}><Icon name="thumbsDown" size={16} /></div>
      {rating && (
        <div className="nc-agent-feedback-comment">
          <textarea ref={ref} className="nc-agent-textarea" rows={2} value={comment} placeholder={t('lp.agents.what_went_well_or_what_should', 'What went well, or what should change?')} onChange={(e) => { setComment(e.target.value); setSent(false); }} />
          <button type="button" className="nc-btn outline small" disabled={sent} onClick={() => void send(rating, comment)}>{sent ? t('lp.agents.thanks', 'Thanks!') : t('lp.agents.send', 'Send')}</button>
        </div>
      )}
    </div>
  );
}

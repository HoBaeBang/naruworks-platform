// Home › My Tasks: tasks assigned to me across the workspace's Tasks databases, due date first
// (server: getMyTasks). Rows show the task, its Status, Due date and the database it lives in ("In …");
// clicking opens the task in side peek. Empty state explains how a database becomes a Tasks database.
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, CollectionRecord, SpaceRecord } from '@nc/shared/records.ts';
import { getPropertyValue } from '@nc/shared/database/values.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { openPage, openPeek } from '../../lib/router.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { ValueView } from '../database/properties/ValueView.tsx';
import { makeQueryContext } from '../database/data.ts';
import { t } from '../shell/i18n.ts';
import './people.css';

interface TaskDb {
  collectionId: string;
  blockId: string;
  name: string;
  statusProperty?: string;
  assigneeProperty?: string;
  dueProperty?: string;
}

type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

function bucketOf(ms: number | null): Bucket {
  if (ms == null || !Number.isFinite(ms)) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  if (ms < t0) return 'overdue';
  if (ms < t0 + 86_400_000) return 'today';
  if (ms < t0 + 7 * 86_400_000) return 'week';
  return 'later';
}

const BUCKET_LABEL: Record<Bucket, () => string> = {
  overdue: () => t('lp.home.overdue', 'Overdue'),
  today: () => t('lp.home.today', 'Today'),
  week: () => t('lp.home.next_7_days', 'Next 7 days'),
  later: () => t('lp.home.later', 'Later'),
  none: () => t('lp.home.no_due_date', 'No due date'),
};

export function MyTasksPage() {
  const spaceId = useSession((s) => s.spaceId);
  const space = records.get<SpaceRecord>('space', spaceId);
  const [data, setData] = useState<{ databases: TaskDb[]; taskIds: string[] } | null>(null);
  const ver = useTableVersion(['block', 'collection']);
  useEffect(() => {
    let alive = true;
    void api('getMyTasks', { spaceId }).then((r) => {
      if (!alive) return;
      records.mergeRecordMap(r.recordMap);
      setData({ databases: r.databases ?? [], taskIds: r.taskIds ?? [] });
    }).catch(() => alive && setData({ databases: [], taskIds: [] }));
    return () => {
      alive = false;
    };
  }, [spaceId]);

  const groups = useMemo(() => {
    if (!data) return [];
    const ctx = makeQueryContext();
    const out = new Map<Bucket, { row: BlockRecord; db: TaskDb; col: CollectionRecord }[]>();
    for (const id of data.taskIds) {
      const row = records.get<BlockRecord>('block', id);
      if (!row || row.alive === false) continue;
      const col = records.get<CollectionRecord>('collection', row.parent_id);
      const db = data.databases.find((d) => d.collectionId === row.parent_id);
      if (!col || !db) continue;
      const due = db.dueProperty ? getPropertyValue(row, db.dueProperty, col.schema, ctx) : null;
      const ms = due && due.kind === 'date' && due.date ? due.date.startMs : null;
      const b = bucketOf(ms);
      out.set(b, [...(out.get(b) ?? []), { row, db, col }]);
    }
    return (['overdue', 'today', 'week', 'later', 'none'] as Bucket[]).filter((b) => out.has(b)).map((b) => ({ bucket: b, items: out.get(b)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ver]);

  const ctx = useMemo(() => makeQueryContext(), [ver]);
  return (
    <div className="lit-scroller vertical nc-ppl nc-tasks">
      <div className="nc-ppl-inner">
        <h1 className="nc-ppl-title">{t('lp.home.my_tasks', 'My Tasks')}</h1>
        {!data && <div className="nc-page-loading" />}
        {data && data.databases.length === 0 && (
          <div className="nc-tasks-empty">
            <Icon name="checkboxChecked" size={32} style={{ color: 'var(--lp-icon-tertiary)' }} />
            <div className="nc-tasks-empty-title">{t('lp.home.see_every_task_in_in_one', 'See every task in {spaceName} in one place.', { spaceName: space?.name ?? '' })}</div>
            <div className="nc-tasks-empty-sub">{t('lp.home.open_a_database_s_menu_and', 'Open a database’s ••• menu and choose “Change to task database”. Tasks assigned to you show up here.')}</div>
          </div>
        )}
        {data && data.databases.length > 0 && data.taskIds.length === 0 && (
          <div className="nc-tasks-empty"><div className="nc-tasks-empty-title">{t('lp.home.no_tasks_assigned_to_you', 'No tasks assigned to you')}</div></div>
        )}
        {groups.map((g) => (
          <section key={g.bucket} className="nc-tasks-group" data-bucket={g.bucket}>
            <h2 className={`nc-tasks-group-title ${g.bucket === 'overdue' ? 'overdue' : ''}`}>{BUCKET_LABEL[g.bucket]()} <span className="count">{g.items.length}</span></h2>
            {g.items.map(({ row, db, col }) => {
              const status = db.statusProperty ? getPropertyValue(row, db.statusProperty, col.schema, ctx) : null;
              const due = db.dueProperty ? getPropertyValue(row, db.dueProperty, col.schema, ctx) : null;
              return (
                <div key={row.id} role="button" className="nc-task-row" data-task-id={row.id} onClick={(e) => ((e.metaKey || e.ctrlKey) ? openPage(row.id, { newTab: true }) : openPeek(row.id, 'side_peek'))}>
                  <PageIcon block={row} size={18} />
                  <span className="nc-task-title nc-ellipsis">{pageTitle(row) || t('lp.home.untitled', 'Untitled')}</span>
                  <span className="nc-task-status">{status && db.statusProperty ? <ValueView value={status} prop={col.schema[db.statusProperty]} ctx={ctx} readOnly /> : null}</span>
                  <span className="nc-task-due">{due && db.dueProperty ? <ValueView value={due} prop={col.schema[db.dueProperty]} ctx={ctx} readOnly /> : null}</span>
                  <span className="nc-task-db nc-ellipsis">{t('lp.home.in', 'In')} {db.name}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

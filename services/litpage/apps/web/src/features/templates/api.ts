// Template catalog client: list (cached), preview records, and "Add to workspace" (server copies the template tree).
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openPage } from '../../lib/router.ts';
import { t } from '../shell/i18n.ts';

export type TemplateCategory = 'work' | 'life' | 'school';

export interface OutlineBlock {
  t: string;
  x: string;
  c?: boolean;
  i?: string;
  db?: OutlineDb | null;
}

export interface OutlineDb {
  name: string;
  view: string;
  columns: { name: string; type: string }[];
  rows: { icon: string; cells: string[] }[];
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  cover: string;
  category: TemplateCategory;
  tags: string[];
  creator: string;
  featured?: boolean;
  pageId: string;
  outline: { blocks?: OutlineBlock[]; db?: OutlineDb | null } | null;
  /** times added to a workspace (all users) */
  adds?: number;
  /** average stars (null until someone reviews it) */
  rating?: number | null;
  reviews?: number;
  updatedTime?: number;
  /** the viewer added it before (Marketplace › Purchased) */
  added?: boolean;
}

export interface TemplateReview {
  userId: string;
  rating: number;
  title: string;
  name: string;
  text: string;
  time: number;
}

export interface AddedTemplate {
  templateId: string;
  time: number;
  times: number;
  pageId: string | null;
  spaceId: string | null;
  myRating: number | null;
}

let cache: Promise<TemplateInfo[]> | null = null;
const listeners = new Set<() => void>();

/** Drop the cached catalog (add counts / ratings changed) and let mounted lists reload. */
export function invalidateTemplates() {
  cache = null;
  for (const fn of listeners) fn();
}

export function loadTemplates(force = false): Promise<TemplateInfo[]> {
  if (!cache || force) {
    cache = api<{ templates: TemplateInfo[] }>('listTemplates')
      .then((r) => r.templates)
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export function useTemplates(): { templates: TemplateInfo[]; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ templates: TemplateInfo[]; loading: boolean; error: string | null }>({ templates: [], loading: true, error: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    listeners.add(bump);
    return () => void listeners.delete(bump);
  }, []);
  useEffect(() => {
    let alive = true;
    loadTemplates()
      .then((templates) => alive && setState({ templates, loading: false, error: null }))
      .catch((e: Error) => alive && setState((s) => ({ templates: s.templates, loading: false, error: e.message })));
    return () => {
      alive = false;
    };
  }, [version]);
  return state;
}

const previews = new Map<string, Promise<string>>();

/** Load the template's records (read-only) into the store; resolves to the template root page id. */
export function loadTemplatePreview(templateId: string): Promise<string> {
  let p = previews.get(templateId);
  if (!p) {
    p = api<{ pageId: string; recordMap: any }>('getTemplatePreview', { templateId }).then((r) => {
      records.mergeRecordMap(r.recordMap);
      return r.pageId;
    });
    p.catch(() => previews.delete(templateId));
    previews.set(templateId, p);
  }
  return p;
}

/** "Add to <workspace>": copy the template into the user's Private section (or into `parentPageId`) and open it. */
export async function addTemplate(templateId: string, opts?: { parentPageId?: string; open?: boolean }): Promise<string> {
  const spaceId = useSession.getState().spaceId;
  const res = await api<{ pageId: string; recordMap: any }>('getTemplate', {
    templateId, spaceId, ...(opts?.parentPageId ? { parent: { kind: 'page', pageId: opts.parentPageId } } : {}),
  });
  records.mergeRecordMap(res.recordMap);
  invalidateTemplates();
  if (opts?.open !== false) openPage(res.pageId);
  useUI.getState().toast(t('lp.templates.template_added_to_your_workspace', 'Template added to your workspace'));
  return res.pageId;
}

/** Templates modal opened from an empty page: that page becomes a copy of the template (title kept if typed). */
export async function applyTemplate(templateId: string, pageId: string): Promise<void> {
  const spaceId = useSession.getState().spaceId;
  const res = await api<{ pageId: string; recordMap: any }>('getTemplate', { templateId, spaceId, applyTo: pageId });
  records.mergeRecordMap(res.recordMap);
  invalidateTemplates();
  useUI.getState().toast(t('lp.templates.template_applied', 'Template applied'));
}

export function loadTemplateReviews(templateId: string) {
  return api<{ reviews: TemplateReview[]; histogram: number[]; mine: TemplateReview | null; canReview: boolean }>('getTemplateReviews', { templateId });
}

export async function submitTemplateReview(templateId: string, review: { rating: number; title?: string; text?: string; name?: string }) {
  await api('reviewTemplate', { templateId, ...review });
  invalidateTemplates();
}

export async function loadAddedTemplates(): Promise<AddedTemplate[]> {
  const res = await api<{ added: AddedTemplate[]; recordMap: any }>('getAddedTemplates');
  records.mergeRecordMap(res.recordMap);
  return res.added;
}

export const CATEGORY_ORDER: TemplateCategory[] = ['work', 'life', 'school'];

export function categoryLabel(c: TemplateCategory): string {
  if (c === 'work') return t('lp.templates.work', 'Work');
  if (c === 'life') return t('lp.templates.life', 'Life');
  return t('lp.templates.school', 'School');
}

export function sectionTitle(c: TemplateCategory): string {
  if (c === 'work') return t('lp.templates.power_up_your_business', 'Power up your business');
  if (c === 'life') return t('lp.templates.bring_your_life_together', 'Bring your life together');
  return t('lp.templates.work_smarter', 'Work smarter');
}
